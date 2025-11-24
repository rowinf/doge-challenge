import { Database } from "bun:sqlite";
import { createHash } from "crypto";

const db = new Database("ecfr.sqlite");

// 1. Initialize Schema
db.run(`
  CREATE TABLE IF NOT EXISTS agencies (
    slug TEXT PRIMARY KEY,
    name TEXT,
    short_name TEXT,
    current_word_count INTEGER,
    current_checksum TEXT,
    last_updated DATETIME
  );
`);

db.run(`
  CREATE TABLE IF NOT EXISTS snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agency_slug TEXT,
    check_date DATE,
    word_count INTEGER,
    checksum TEXT,
    FOREIGN KEY(agency_slug) REFERENCES agencies(slug)
  );
`);

// 2. Helper Functions
function cleanText(xml: string): string {
  // Brutal regex strip for demo speed - in prod use a real XML parser
  return xml.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function getChecksum(text: string): string {
  return createHash("sha256").update(text).digest("hex").substring(0, 12);
}

// 3. The Sync Job
async function runSync() {
  console.log("🚀 Starting eCFR Sync...");
  
  // A. Fetch Agency List
  const response = await fetch("https://www.ecfr.gov/api/admin/v1/agencies.json");
  const data = await response.json();
  const agencies = (data.agencies || []).slice(0, 5); // Limit to 5 for demo speed

  const upsertAgency = db.prepare(`
    INSERT INTO agencies (slug, name, short_name, current_word_count, current_checksum, last_updated)
    VALUES ($slug, $name, $short, $count, $sum, CURRENT_TIMESTAMP)
    ON CONFLICT(slug) DO UPDATE SET
      current_word_count = $count,
      current_checksum = $sum,
      last_updated = CURRENT_TIMESTAMP
  `);

  const insertSnapshot = db.prepare(`
    INSERT INTO snapshots (agency_slug, check_date, word_count, checksum)
    VALUES ($slug, DATE('now'), $count, $sum)
  `);

  for (const agency of agencies) {
    console.log(`Processing: ${agency.name}...`);
    
    // B. Fetch Content (Mocking the "Title" fetch for simplicity)
    // In reality, you'd loop through agency.references to get specific Titles
    // We will simulate fetching a large XML body for this agency
    const mockRes = await fetch(`https://www.ecfr.gov/api/versioner/v1/full/2024-11-20/title-1.xml?agency=${agency.slug}`);
    // Fallback if that specific endpoint fails in this demo context:
    const rawXml = mockRes.ok ? await mockRes.text() : `<xml>Regulatory text for ${agency.name}...</xml>`; 

    // C. Process
    const text = cleanText(rawXml);
    const wordCount = text.split(" ").length;
    const checksum = getChecksum(text);

    // D. Write to DB
    upsertAgency.run({
      $slug: agency.slug,
      $name: agency.name,
      $short: agency.short_name || agency.name,
      $count: wordCount,
      $sum: checksum
    });

    insertSnapshot.run({
      $slug: agency.slug,
      $count: wordCount,
      $sum: checksum
    });
  }
  console.log("✅ Sync Complete.");
}

// Run if called directly
if (import.meta.main) runSync();