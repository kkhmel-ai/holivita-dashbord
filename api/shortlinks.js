const { sql } = require('@vercel/postgres');

function dstr(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

// Live click counts per short-link code, read from our own daily-snapshot
// table (see api/shortlink-snapshot.js). The shortlinker itself
// (s.holivita.ai) has no public API or export — its own admin panel
// (s-admin.holivita.ai) is an interactive Streamlit console with no JSON
// endpoint — so this is only as fresh as the last snapshot write, not truly
// real-time. Replaces the old hand-typed SHORTLINKS constant in index.html
// that had to be retyped from a screenshot every time and went stale for
// weeks between updates.
module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  try {
    await sql`CREATE TABLE IF NOT EXISTS shortlink_snapshots (
      code TEXT NOT NULL,
      snapshot_date DATE NOT NULL,
      clicks INTEGER NOT NULL,
      source TEXT,
      medium TEXT,
      campaign TEXT,
      PRIMARY KEY (code, snapshot_date)
    )`;
    const { rows } = await sql`
      SELECT DISTINCT ON (code) code, snapshot_date, clicks, source, medium, campaign
      FROM shortlink_snapshots
      ORDER BY code, snapshot_date DESC
    `;
    const links = {};
    let asOf = null;
    rows.forEach((r) => {
      links[r.code] = {
        clicks: r.clicks,
        approx: false,
        source: r.source,
        medium: r.medium,
        campaign: r.campaign,
      };
      const d = dstr(r.snapshot_date);
      if (!asOf || d > asOf) asOf = d;
    });
    res.status(200).json({ links, asOf });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
