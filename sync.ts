import { SQL } from "bun";
import { Database } from "bun:sqlite";
import { createHash } from "crypto";

const sqlite = new SQL("sqlite://ecfr.sqlite");
// --- Configuration ---
// For the demo, we only look at the top 5 agencies to save time.
const AGENCY_LIMIT = 5;
// We check today and the same date for the last 2 years
const SNAPSHOT_DATES = [
    //   new Date().toISOString().split('T')[0], // Today
    new Date(new Date().setFullYear(new Date().getFullYear() - 1)).toISOString().split('T')[0], // 1 year ago
    new Date(new Date().setFullYear(new Date().getFullYear() - 2)).toISOString().split('T')[0], // 2 years ago
    new Date(new Date().setFullYear(new Date().getFullYear() - 3)).toISOString().split('T')[0], // 3 years ago
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
    agency_slug TEXT,
    check_date DATE,
    word_count INTEGER,
    checksum TEXT,
    UNIQUE(agency_slug, check_date)
  );
`;

// --- 2. Helpers ---
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function cleanText(xml: string): string {
    // Strips tags to get raw regulatory text
    return xml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function getChecksum(text: string): string {
    return createHash("sha256").update(text).digest("hex").substring(0, 12);
}

// --- 3. Main Sync Logic ---
async function runSync() {
    console.log(`🏛️  Starting Historical Sync for ${SNAPSHOT_DATES.length} time points...`);
    const todaysDate = new Date().toISOString().split('T')[0];

    // A. Get Agency List
    const resp = await fetch("https://www.ecfr.gov/api/admin/v1/agencies.json");
    const data = await resp.json();

    // Filter: Only agencies that actually have a Title reference
    const agencies = (data.agencies || [])
        .filter((a: any) => a.cfr_references && a.cfr_references.length > 0)
        .slice(0, AGENCY_LIMIT);

    // C. The Loop
    for (const agency of agencies) {
        const title = agency.cfr_references[0].title; // Grab their primary Title
        const shortName = agency.short_name || agency.name;
        console.log(`\nProcessing: ${agency.short_name || agency.name} (Title ${title})`);
        await sqlite`
            INSERT INTO agencies (slug, name, short_name)
            VALUES (${agency.slug}, ${agency.name}, ${shortName})
            ON CONFLICT(slug) DO UPDATE SET name = ${agency.name}
        `;

        // Iterate through history (Today -> Past)
        for (const date of SNAPSHOT_DATES) {
            process.stdout.write(`  -> Fetching ${date}... `);

            try {
                // REAL API CALL: Fetch full XML for this Title on this Date
                const url = `https://www.ecfr.gov/api/versioner/v1/full/${date}/title-${title}.xml`;
                const res = await fetch(url);

                if (!res.ok) {
                    console.log(`❌ (Status ${res.status})`);
                    continue;
                }

                const xml = await res.text();

                // "Analyze" the data
                const text = cleanText(xml);
                const wordCount = text.split(" ").length;
                const checksum = getChecksum(text);

                // Save Snapshot
                await sqlite`
                    INSERT INTO snapshots (agency_slug, check_date, word_count, checksum)
                    VALUES (${agency.slug}, ${date}, ${wordCount}, ${checksum})
                    ON CONFLICT(agency_slug, check_date) DO NOTHING
                `;

                console.log(`✅ Words: ${wordCount.toLocaleString()}`);

                // Update "Latest" cache if this is today's date
                if (date === SNAPSHOT_DATES[0]) {
                    await sqlite`
                        UPDATE agencies 
                            SET latest_word_count = ${wordCount}, 
                            latest_checksum = ${checksum},
                            last_updated_date = ${todaysDate}
                        WHERE slug = ${agency.slug}
                    `;
                }

            } catch (err) {
                console.log(`⚠️ Error: ${err}`);
            }

            // Be polite to the API
            await sleep(1000);
        }
    }

    console.log("\n🚀 Sync Complete.");
}

runSync();