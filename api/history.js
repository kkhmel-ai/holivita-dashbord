const { sql } = require('@vercel/postgres');

// Returns, for every tracked account, the most recent follower snapshot on
// or before the requested date. The front end uses this to compare "now"
// against "period length ago" (yesterday / last week / last month), instead
// of relying on LiveDune's date_from/date_to filters (which don't return
// real historical data).
module.exports = async (req, res) => {
  const date = req.query.date;
  if (!date) {
    return res.status(400).json({ error: 'date query param (YYYY-MM-DD) is required' });
  }
  try {
    await sql`CREATE TABLE IF NOT EXISTS follower_snapshots (
      account_id BIGINT NOT NULL,
      snapshot_date DATE NOT NULL,
      followers INTEGER NOT NULL,
      platform TEXT,
      PRIMARY KEY (account_id, snapshot_date)
    )`;
    const { rows } = await sql`
      SELECT DISTINCT ON (account_id) account_id, snapshot_date, followers, platform
      FROM follower_snapshots
      WHERE snapshot_date <= ${date}
      ORDER BY account_id, snapshot_date DESC
    `;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ response: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
