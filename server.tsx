import { Hono } from "hono";
import { Database } from "bun:sqlite";

const app = new Hono();
const db = new Database("ecfr.sqlite");

// --- 1. CORE LOGIC: Calculate Velocity & Stats ---
function getAgencyStats(slug: string) {
  // JOIN: Agencies -> References -> Snapshots
  // We sum up the word counts of all Titles associated with this agency for each distinct date.
  const query = db.query(`
    SELECT s.snapshot_date, SUM(s.word_count) as total_words
    FROM agency_references ar
    JOIN snapshots s ON s.title = ar.title_number
    WHERE ar.agency_slug = $slug
    GROUP BY s.snapshot_date
    ORDER BY s.snapshot_date DESC
  `);

  const history = query.all({ $slug: slug }) as { snapshot_date: string, total_words: number }[];

  // Defaults
  let velocity = 0;
  let latest_count = 0;

  if (history.length > 0) {
    latest_count = history[0].total_words;

    if (history.length >= 2) {
      const newest = history[0];
      const oldest = history[history.length - 1];

      // Calculate time difference in years
      const msDiff = new Date(newest.snapshot_date).getTime() - new Date(oldest.snapshot_date).getTime();
      const years = Math.ceil(msDiff / (1000 * 60 * 60 * 24 * 365.25));

      // Velocity = (New Words - Old Words) / Years
      const diff = newest.total_words - oldest.total_words;
      // Avoid divide by zero if dates are identical
      velocity = years > 0.01 ? Math.round(diff / years) : 0;
    }
  }

  return { velocity, latest_count, history };
}

// --- 2. API ENDPOINTS (Meeting the requirement) ---

app.get("/api/agencies", (c) => {
  const agencies = db.query("SELECT * FROM agencies").all() as any[];
  const data = agencies.map(a => ({
    ...a,
    stats: getAgencyStats(a.slug)
  }));
  return c.json(data);
});

// --- 3. UI DASHBOARD (The DOGE View) ---

const Layout = ({ children }: any) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>DOGE: RegTracker</title>
      <script src="https://unpkg.com/htmx.org@2.0.4"></script>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css" />
      <style>{`
        :root { --primary: #ff9900; --background: #000; --text: #eee; }
        body { background-color: #111; color: #eee; }
        nav strong { color: var(--primary); font-size: 1.2rem; }
        table { --border-color: #333; }
        
        /* Velocity Colors */
        .vel-bad { color: #ff4444; font-weight: bold; }   /* Increasing Regs */
        .vel-good { color: #00cc00; font-weight: bold; }  /* Decreasing Regs */
        .vel-neutral { color: #666; }
        
        /* Sparkline Bar */
        .spark-container { display: flex; align-items: flex-end; gap: 3px; height: 40px; }
        .spark-bar { width: 8px; border-radius: 2px 2px 0 0; transition: height 0.3s; }
      `}</style>
    </head>
    <body>
      <main class="container">
        <nav>
          <ul><li><strong>🏛️ Dept. of Gov Efficiency</strong></li></ul>
          <ul>
            <li><a href="/api/agencies" class="secondary">JSON API</a></li>
          </ul>
        </nav>
        {children}
      </main>
    </body>
  </html>
);

app.get("/", (c) => {
  // Fetch agencies and calculate stats for each
  const agencies = db.query("SELECT * FROM agencies").all() as any[];

  const analyzedData = agencies.map(a => {
    return { ...a, ...getAgencyStats(a.slug) };
  });

  // Sort by Velocity (Highest Growth First = Worst Offenders)
  analyzedData.sort((a, b) => b.velocity - a.velocity);

  return c.html(
    <Layout>
      <hgroup>
        <h2>Regulatory Burden Index</h2>
        <h3>Tracking the velocity of federal code expansion.</h3>
      </hgroup>

      <figure>
        <table role="grid">
          <thead>
            <tr>
              <th>Agency</th>
              <th>Total Words (Current)</th>
              <th>Velocity (Words/Yr)</th>
              <th>Trend (Last 2 Years)</th>
            </tr>
          </thead>
          <tbody>
            {analyzedData.map((row: any) => {
              // Determine Color
              let vClass = "vel-neutral";
              if (row.velocity > 100) vClass = "vel-bad";
              if (row.velocity < -100) vClass = "vel-good";

              const prefix = row.velocity > 0 ? "+" : "";

              // Sparkline Math: Find max value in history to normalize bar height
              const maxVal = Math.max(...row.history.map((h: any) => h.total_words));

              return (
                <tr>
                  <td>
                    <strong>{row.short_name}</strong><br />
                    <small style="color:#666">{row.name}</small>
                  </td>
                  <td>{row.latest_count.toLocaleString()}</td>
                  <td class={vClass}>
                    {prefix}{row.velocity.toLocaleString()}
                  </td>
                  <td>
                    <div class="spark-container">
                      {/* Reverse history so oldest is on left */}
                      {[...row.history].reverse().map((h: any) => {
                        // Calculate height percentage (min 10% so it's visible)
                        const pct = (h.total_words / maxVal) * 100;
                        // Color based on comparison to previous year could be cool, but keep simple
                        return (
                          <div
                            class="spark-bar"
                            style={`height:${pct}%; background-color: ${row.velocity > 0 ? '#ff4444' : '#00cc00'}; opacity: 0.7;`}
                            data-tooltip={`${h.snapshot_date}: ${h.total_words.toLocaleString()}`}
                          ></div>
                        )
                      })}
                    </div>
                    <small style="font-size:0.6rem; color:#555">
                      {row.history.length > 0 ? row.history[row.history.length - 1].snapshot_date : ''}
                      →
                      {row.history.length > 0 ? row.history[0].snapshot_date : ''}
                    </small>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </figure>

      <footer>
        <small>Generated by DOGE Engine v1.0 • Running on Bun/Hono/SQLite</small>
      </footer>
    </Layout>
  );
});

export default app;