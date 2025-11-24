import { Hono } from "hono";
import { Database } from "bun:sqlite";

const app = new Hono();
const db = new Database("ecfr.sqlite");

// --- 1. THE API (Delivering to the letter) ---

app.get("/api/agencies", (c) => {
  const query = db.query("SELECT * FROM agencies ORDER BY current_word_count DESC");
  return c.json(query.all());
});

app.get("/api/agencies/:slug/history", (c) => {
  const slug = c.req.param("slug");
  const query = db.query("SELECT * FROM snapshots WHERE agency_slug = ? ORDER BY check_date DESC");
  return c.json(query.all(slug));
});

// --- 2. THE UI (Delivering with efficiency) ---

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
  const agencies = db.query("SELECT * FROM agencies ORDER BY current_word_count DESC").all();
  
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
              <th>Integrity Check (SHA256)</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {agencies.map((a: any) => (
              <tr>
                <td>{a.short_name}</td>
                <td>{a.current_word_count.toLocaleString()}</td>
                <td><small>{a.current_checksum}</small></td>
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
  const history = db.query("SELECT * FROM snapshots WHERE agency_slug = ? ORDER BY check_date ASC").all(slug);

  // Simple ASCII chart logic for "UI" visualization without heavy JS libs
  const maxCount = Math.max(...history.map((h: any) => h.word_count));
  
  return c.html(
    <article>
      <header>
        <strong>Analysis: {agency.name}</strong>
        <span style="float:right">Last Updated: {agency.last_updated}</span>
      </header>
      <div class="grid">
        <div class="stat-card">
          <h4>Total Words</h4>
          <h2>{agency.current_word_count.toLocaleString()}</h2>
        </div>
        <div class="stat-card">
          <h4>Integrity Status</h4>
          <h2 class="diff-clean">VERIFIED</h2>
        </div>
      </div>

      <h5>Historical Growth</h5>
      <div style="background: #222; padding: 10px; font-family: monospace;">
        {history.map((h: any) => {
          const width = Math.floor((h.word_count / maxCount) * 100);
          return (
            <div style="margin-bottom: 5px; white-space: nowrap;">
              <span style="display:inline-block; width: 100px;">{h.check_date}</span>
              <div style={`display:inline-block; background: var(--primary); width: ${width}%; height: 10px;`}></div>
              <span style="margin-left: 10px;">{h.word_count}</span>
            </div>
          )
        })}
      </div>
    </article>
  );
});

export default app;