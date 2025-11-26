import { Hono } from "hono";
import { Database } from "bun:sqlite";

const app = new Hono();
const db = new Database("ecfr.sqlite");

function formatFileSize(bytes: number, decimalPoint = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1000;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(decimalPoint)) + ' ' + sizes[i];
}

function getStats(slug: string) {
  // Sum byte_size across all titles for this agency
  const rows = db.query(`
    SELECT s.snapshot_date, SUM(s.byte_size) as total_bytes, SUM(ar.chapter_byte_size) as total_referenced_size
    FROM agency_references ar
    JOIN snapshots s ON s.title_number = ar.title_number
    WHERE ar.agency_slug = $slug
    GROUP BY s.snapshot_date
    ORDER BY s.snapshot_date DESC
  `).all({ $slug: slug }) as any[];

  if (rows.length < 2) return { velocity: 0, current: 0, history: [] };

  const newest = rows[0];
  const oldest = rows[rows.length - 1];
  
  // Calculate Velocity (Sections added per year)
  const years = (new Date(newest.snapshot_date).getTime() - new Date(oldest.snapshot_date).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
  const diff_bytes = newest.total_bytes - oldest.total_bytes;
  
  // Avoid divide by zero
  const velocity = years > 0.1 ? Math.round(diff_bytes / years) : 0;
  return {
    velocity: velocity,
    current: newest.total_bytes,
    history: rows,
    increasing: diff_bytes == 0 ? null : diff_bytes > 0,
    total_referenced_size: rows.reduce((tot, row) => (tot += row.total_referenced_size), 0),
  };
}

const Layout = ({ children }: any) => (
  <html data-theme="dark">
    <head>
      <title>DOGE: Complexity Tracker</title>
      <script src="https://unpkg.com/htmx.org@1.9.10"></script>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@picocss/pico@2/css/pico.min.css" />
      <style>{`
        :root { --primary: #e6b800; }
        .trend-up { color: #ff5555; }
        .trend-down { color: #55ff55; }
        .spark-bar { width: 8px; border-radius: 2px 2px 0 0; transition: height 0.3s; }
      `}</style>
    </head>
    <body>
      <main class="container">
        <nav>
          <ul><li><strong>📜 Reg Complexity Index</strong></li></ul>
        </nav>
        {children}
      </main>
    </body>
  </html>
);

app.get("/", (c) => {
  const agencies = db.query("SELECT * FROM agencies").all() as any[];
  
  const data = agencies
    .map(a => ({ ...a, ...getStats(a.slug) }))
    .filter(a => a.history.length > 0)
    .sort((a, b) =>  b.velocity - a.velocity); // Most new sections first

  return c.html(
    <Layout>
      <p>Tracking the <strong>size</strong> of rule documents enforced by agencies.</p>
      <table role="grid">
        <thead>
          <tr>
            <th>Agency</th>
            <th><span data-tooltip="Sum of agency regulatory document size" data-placement="left">Total Size</span></th>
            <th><span data-tooltip="Average change in total document size/year" data-placement="left">Velocity</span></th>
            <th><span data-tooltip="2 yrs ago, 1 yr ago, 60 days ago" data-placement="left">Trend</span></th>
          </tr>
        </thead>
        <tbody>
          {data.map((row: any) => {
            const trendClass = row.increasing ? "trend-up" : (row.increasing === false ? "trend-down" : "");
            const sign = row.increasing > 0 ? "+" : "";
            const maxVal = Math.max(...row.history.map((h:any) => h.total_bytes));
            
            return (
              <tr>
                <td><span data-tooltip={row.name} data-placement="right">{row.short_name}</span></td>
                <td>{formatFileSize(row.current)}</td>
                <td class={trendClass}>
                  {sign}{formatFileSize(Math.abs(row.velocity))}
                </td>
                <td>
                  <div style="display: flex; align-items: flex-end; gap: 2px; height: 30px;">
                    {[...row.history].reverse().map((h: any) => (
                      <div class="spark-bar" data-tooltip={formatFileSize(h.total_bytes)} style={`
                        height: ${(h.total_bytes / maxVal) * 100}%;
                        background-color: ${row.velocity > 0 ? '#ff5555' : '#55ff55'};
                        opacity: 0.8;
                      `} title={`${h.snapshot_date}: ${h.total_bytes}`}></div>
                    ))}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </Layout>
  );
});

export default app;