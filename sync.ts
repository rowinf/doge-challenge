import { SQL } from "bun";
import { Database } from "bun:sqlite";

const sqlite = new SQL("sqlite://ecfr.sqlite");

// --- Config ---
const SNAPSHOT_DATES = [
    new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // 60 days ago
    new Date(new Date().setFullYear(new Date().getFullYear() - 1)).toISOString().split('T')[0], // 1 Year Ago
    new Date(new Date().setFullYear(new Date().getFullYear() - 2)).toISOString().split('T')[0], // 2 Years Ago
];
// const SHARED_TITLES = [1, 2, 3, 4, 5, 6, 41, 48]; 

// --- Schema ---
await sqlite`
    CREATE TABLE IF NOT EXISTS agencies (
        slug TEXT PRIMARY KEY,
        name TEXT,
        short_name TEXT,
        last_updated_date DATE
    );
`;
await sqlite`
    CREATE TABLE IF NOT EXISTS agency_references (
        agency_slug TEXT,
        title_number INTEGER,
        chapter TEXT,
        UNIQUE(agency_slug, title_number)
    );
`;
// We will store the "size" directly here
await sqlite`
    CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title_number INTEGER,
        snapshot_date DATE,
        byte_size INTEGER, 
        UNIQUE(title_number, snapshot_date)
    );
`;

async function runSync() {
    console.log(`💎 Starting "Golden Path" Sync (Using Metadata Size)...`);

    // 1. Fetch Agencies
    const resp = await fetch("https://www.ecfr.gov/api/admin/v1/agencies.json");
    const data = await resp.json();
    const agencies = (data.agencies || []).filter((a: any) => a.cfr_references?.length > 0);
    const checkedSnapshots = new Set<string>();

    for (const agency of agencies) {
        const shortName = agency.short_name || agency.name;
        
        // Upsert Agency
        await sqlite`
            INSERT INTO agencies (slug, name, short_name, last_updated_date)
            VALUES (${agency.slug}, ${agency.name}, ${shortName}, ${SNAPSHOT_DATES[0]})
            ON CONFLICT(slug) DO UPDATE SET last_updated_date = ${SNAPSHOT_DATES[0]}
        `;

        process.stdout.write(`\n🏢 ${shortName}: `);

        for (const ref of agency.cfr_references) {
            const title = ref.title;
            // if (SHARED_TITLES.includes(title)) {
            //     process.stdout.write(`x`); 
            //     continue;
            // };

            await sqlite`INSERT OR IGNORE INTO agency_references VALUES (${agency.slug}, ${title}, ${ref.chapter})`;

            for (const date of SNAPSHOT_DATES) {
                const key = `${title}-${date}`;
                if (checkedSnapshots.has(key)) {
                    process.stdout.write(`s`); 
                    continue;
                };

                // Check DB
                const exists = await sqlite`SELECT id FROM snapshots WHERE title_number=${title} AND snapshot_date=${date}`.values();
                if (exists.length > 0) {
                    checkedSnapshots.add(key);
                    process.stdout.write(`s`); 
                    continue;
                }

                // 2. Fetch Structure JSON
                try {
                    const url = `https://www.ecfr.gov/api/versioner/v1/structure/${date}/title-${title}.json`;
                    const res = await fetch(url);

                    if (res.ok) {
                        // FORCE TEXT PARSING (Ignores "octet-stream" header)
                        const rawText = await res.text();
                        if (!rawText) {
                            process.stdout.write(`o`); 
                            continue;
                        };

                        const structure = JSON.parse(rawText);
                        
                        // --- THE MAGIC FIELD ---
                        const size = structure.size || 0; // The Holy Grail

                        if (size > 0) {
                            await sqlite`
                                INSERT INTO snapshots (title_number, snapshot_date, byte_size)
                                VALUES (${title}, ${date}, ${size})
                            `;
                            process.stdout.write(`.`); 
                        } else {
                            process.stdout.write(`o`);
                        }
                    }
                } catch (e) {
                    console.error(e);
                }
                
                checkedSnapshots.add(key);
                await new Promise((r) => setTimeout(r, 150)); // Fast, but polite
            }
        }
    }
    console.log("\n🚀 Sync Complete.");
}

runSync();