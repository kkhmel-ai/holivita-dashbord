const { sql } = require('@vercel/postgres');

function dstr(v) {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

// Full day-by-day click history per short-link code, built from our own
// snapshots (see api/shortlink-snapshot.js) since the shortlinker has no
// history endpoint of its own — every "day" here is a point in time someone
// (or an automated refresh, once one exists) pulled fresh numbers from the
// admin panel at s-admin.holivita.ai, not a guaranteed daily cadence. Used
// for the "Переходы по закреплённым ссылкам" chart (bio-link codes
// INST/TELEGRAM/FACEBOOK) on the UTM tab — same shape as
// api/livedune-history.js's follower history so the chart code can reuse
// the same rendering pattern.
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
      SELECT code, snapshot_date, clicks
      FROM shortlink_snapshots
      ORDER BY code, snapshot_date
    `;
    const codes = {};
    rows.forEach((r) => {
      const c = (codes[r.code] = codes[r.code] || { days: [] });
      c.days.push({ date: dstr(r.snapshot_date), clicks: r.clicks });
    });
    res.status(200).json({ codes });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
