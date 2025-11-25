import { SQL } from "bun";
import { createHash } from "crypto";

const sqlite = new SQL("sqlite://ecfr.sqlite");
// --- Configuration ---
// For the demo, we only look at the top 5 agencies to save time.
const AGENCY_LIMIT = 5;
// We check today and the same date for the last 2 years
const SNAPSHOT_DATES = [
     new Date(Date.now() - 86400000 * 60).toISOString().split('T')[0], // two Months Ago
    new Date(new Date().setFullYear(new Date().getFullYear() - 1)).toISOString().split('T')[0], // 1 year ago
    new Date(new Date().setFullYear(new Date().getFullYear() - 2)).toISOString().split('T')[0], // 2 years ago
    // new Date(new Date().setFullYear(new Date().getFullYear() - 3)).toISOString().split('T')[0], // 3 years ago
];

// --- 1. Database Schema ---
await sqlite`
    CREATE TABLE IF NOT EXISTS agencies (
        slug TEXT PRIMARY KEY,
        name TEXT,
        short_name TEXT,
        latest_word_count INTEGER,
        latest_checksum TEXT,
        primary_title INTEGER,
        last_updated_date DATE 
    );
`;

await sqlite`
    CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title INTEGER,
        snapshot_date DATE,
        word_count INTEGER,
        checksum TEXT
    );
`;

await sqlite`
    CREATE TABLE IF NOT EXISTS agency_references (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agency_slug TEXT,
        title_number INTEGER,
        chapter TEXT,
        FOREIGN KEY(agency_slug) REFERENCES agencies(slug)
    );
`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function cleanText(xml: string): string {
    return xml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function getChecksum(text: string): string {
    return createHash("sha256").update(text).digest("hex").substring(0, 12);
}

async function runSync() {
    console.log(`🏛️  Starting Historical Sync for ${SNAPSHOT_DATES.length} time points...`);
    const todaysDate = new Date().toISOString().split('T')[0];

    const resp = await fetch("https://www.ecfr.gov/api/admin/v1/agencies.json");
    const data = await resp.json();

    // Filter: Only agencies that actually have a Title reference
    const agencies = (data.agencies || [])
        .filter((a: any) => a.cfr_references && a.cfr_references.length > 0)
        .slice(3, AGENCY_LIMIT + 3);
    // memory cache for snapshots already fetched
    const processedSnapshots = new Set<string>();
    
    for (const agency of agencies) {
        const shortName = agency.short_name || agency.name;
        await sqlite`
            INSERT INTO agencies (slug, name, short_name)
            VALUES (${agency.slug}, ${agency.name}, ${shortName})
            ON CONFLICT(slug) DO UPDATE SET name = ${agency.name}
        `;
        for (const reference of agency.cfr_references) {
            const {title, chapter} = reference;
            console.log(`\nProcessing: ${agency.short_name || agency.name} (Title ${title})`);
            await sqlite`
                INSERT OR IGNORE INTO agency_references (agency_slug, title_number, chapter)
                VALUES (${agency.slug}, ${title}, ${chapter})
            `;

            for (const date of SNAPSHOT_DATES) {
                const cacheKey = `${title}-${date}`;

                // 1. Check Memory Cache (Did we just download this 5 seconds ago?)
                if (processedSnapshots.has(cacheKey)) {
                    console.log(`   ⏭️  Skipping Title ${title} (Already processed this run)`);
                    continue; 
                }
                const existing = await sqlite`
                    SELECT id FROM snapshots 
                    WHERE title = ${title} AND snapshot_date = ${date}
                `.values();

                if (existing.length > 0) {
                    console.log(`   💾 DB Hit: Title ${title} on ${date}`);
                    processedSnapshots.add(cacheKey);
                    continue; 
                }

                // retry up to 3 times in case of errors
                let tries = 0;
                let success = false;
                while (tries < 3 && !success) {
                    tries++;
                    try {
                        console.log(`   ⬇️  Downloading Title ${title} (${date})... `);
                        const url = `https://www.ecfr.gov/api/versioner/v1/full/${date}/title-${title}.xml`;
                        const res = await fetch(url);
                        if (!res.ok) {
                            console.log(`❌ (Status ${res.status})`);
                            throw new Error(`(Status ${res.status})`);
                        }

                        const xml = await res.text();

                        // "Analyze" the data
                        const text = cleanText(xml);
                        const wordCount = text.split(" ").length;
                        const checksum = getChecksum(text);

                        await sqlite`
                            INSERT INTO snapshots (snapshot_date, word_count, checksum, title)
                            VALUES (${date}, ${wordCount}, ${checksum}, ${title})
                        `;

                        console.log(`✅ Words: ${wordCount.toLocaleString()}`);

                        if (date === SNAPSHOT_DATES[0]) {
                            await sqlite`
                                UPDATE agencies 
                                    SET latest_word_count = ${wordCount},
                                    latest_checksum = ${checksum},
                                    last_updated_date = ${todaysDate}
                                WHERE slug = ${agency.slug}
                            `;
                        }
                        processedSnapshots.add(cacheKey);
                        success = true;
                    } catch (err) {
                        console.log(`⚠️ Error: ${err}`);
                        // Be polite to the API
                        const seconds = (3*tries)**2;
                        console.log(`retrying after ${seconds}s`);
                        await sleep(1000 * seconds);
                    }
                }

                // Be polite to the API
                await sleep(1000);
            }
            // Be polite to the API
            await sleep(1000);
        }
    }
    console.log("\n🚀 Sync Complete.");
}

runSync();