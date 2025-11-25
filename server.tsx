import { Hono } from "hono";
import { Database } from "bun:sqlite";

const app = new Hono();
const db = new Database("ecfr.sqlite");

app.get("/api/agencies", (c) => {
  const query = db.query("SELECT * FROM agencies ORDER BY latest_word_count DESC");
  return c.json(query.all());
});

app.get("/api/agencies/:slug/history", (c) => {
  const slug = c.req.param("slug");
  const query = db.query("SELECT * FROM snapshots WHERE agency_slug = ? ORDER BY check_date DESC");
  return c.json(query.all(slug));
});

function getAgencyStats(slug: string) {
  // 1. JOIN Agencies -> References -> Snapshots
  const rows = db.query(`
    SELECT s.snapshot_date, SUM(s.word_count) as total_words
    FROM agency_references ar
    JOIN snapshots s ON s.title = ar.title_number
    WHERE ar.agency_slug = $slug
    GROUP BY s.snapshot_date
    ORDER BY s.snapshot_date DESC
  `).all({ $slug: slug });

  if (rows.length < 2) return { velocity: 0, history: rows };

  const newest = rows[0] as any;
  const oldest = rows[rows.length - 1] as any;

  // 2. Calculate Years Elapsed
  const msDiff = new Date(newest.snapshot_date).getTime() - new Date(oldest.snapshot_date).getTime();
  const years = msDiff / (1000 * 60 * 60 * 24 * 365.25);

  // 3. Velocity = Change / Years
  const diff = newest.total_words - oldest.total_words;
  const velocity = years > 0 ? Math.round(diff / years) : 0;

  return { 
    velocity, 
    latest_count: newest.total_words,
    history: rows 
  };
}

const Layout = ({ children }) => (
  <html>
    <head>
      <title>DOGE: RegTracker</title>
      <script src="https://unpkg.com/htmx.org@2.0.4"></script>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@1/css/pico.min.css" />
      <style>{`
        :root { --primary: #ff9900; } /* Doge Orange */
        .stat-card { padding: 20px; background: #1a1a1a; margin-bottom: 20px; border-radius: 8px; }
        .diff-changed { color: red; }
        .diff-clean { color: green; }
        .word-count-vis {
          background: #222; 
          padding: 10px; 
          font-family: monospace;
          * {
            white-space: nowrap;
            display: grid;
            grid-template-columns: 8rem 1fr 5rem;
            align-items:baseline;
            gap:1rem;
          }
          .bar {
            background: var(--primary);
            height: 10px;
          }
        }
      `}</style>
    </head>
    <body>
      <main class="container">
        <nav>
          <ul><li><strong>🏛️ Dept. of Gov Efficiency</strong></li></ul>
          <ul><li><a href="/">Dashboard</a></li><li><a href="/api/agencies">Raw API</a></li></ul>
        </nav>
        {children}
      </main>
    </body>
  </html>
);

app.get("/", (c) => {
  const agencies = db.query("SELECT * FROM agencies ORDER BY latest_word_count DESC").all();
  const data = agencies.map((a: any) => {
    const stats = getAgencyStats(a.slug);
    return { ...a, ...stats };
  }).sort((a, b) => b.velocity - a.velocity); // Sort by highest velocity (Worst offenders first)
  return c.html(
    <Layout>
      <hgroup>
        <h2>Regulatory Burden Index</h2>
        <h3>Tracking word count and integrity of federal regulations.</h3>
      </hgroup>

      <figure>
        <table role="grid">
          <thead>
            <tr>
              <th>Agency</th>
              <th>Word Count</th>
              <th>Stats</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {data.map((a: any) => (
              <tr>
                <td>{a.short_name}</td>
                <td>{a.latest_count.toLocaleString()}</td>
                <td>
                  <div style="display: flex; align-items: flex-end; height: 30px; gap: 2px;">
                      {a.history.slice(0, 5).reverse().map((h: any) => {
                        const height = Math.max(5, (h.total_words / a.latest_count) * 100 * 0.3); // Scale down
                        return <div style={`width:6px; height:${height}px; background:${a.velocity > 0 ? 'red' : 'green'}; opacity: 0.6;`}></div>
                      })}
                  </div>
                </td>
                <td>
                  <button
                    class="outline"
                    hx-get={`/agency/${a.slug}`}
                    hx-target="#detail-view"
                  >
                    Analyze
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </figure>

      <div id="detail-view"></div>
    </Layout>
  );
});

app.get("/agency/:slug", (c) => {
  const slug = c.req.param("slug");
  const agency = db.query("SELECT * FROM agencies WHERE slug = ?").get(slug) as any;
  const history = db.query(
    `SELECT ar.title_number, s.word_count, snapshot_date
    FROM agency_references ar
    JOIN snapshots s ON s.title = ar.title_number
    WHERE ar.agency_slug = ?
    GROUP BY ar.title_number, snapshot_date;`
  ).all(slug);

  const maxCount = Math.max(...history.map((h: any) => h.word_count));

  return c.html(
    <article>
      <header>
        <strong>Analysis: {agency.name}</strong>

      </header>
      <div class="grid">
        <div class="stat-card">
          <h4>Latest Word Count</h4>
          <h2>{agency.latest_word_count.toLocaleString()}</h2>
        </div>
        <div class="stat-card">
          <h4>Last Updated</h4>
          <h2>{agency.last_updated_date}</h2>
        </div>
      </div>

      <h5>Historical Growth</h5>
      <div class="word-count-vis">
        <div>
          <span>title/date</span><span>Graph</span><span># Words</span>
        </div>
        {history.map((h: any) => {
          const width = Math.floor((h.word_count / maxCount) * 100);
          return (
            <div>
              <span>{h.title_number}/{h.snapshot_date}</span>
              <div class="bar" style={`width: ${width}%`}></div>
              <span>{h.word_count}</span>
            </div>
          )
        })}
      </div>
    </article>
  );
});

export default app;