const { sql } = require('@vercel/postgres');

// Writes one day's click-count snapshot for a batch of short-link codes.
// Unlike api/snapshot.js (followers), there's no Vercel Cron entry for this
// in vercel.json — the shortlinker (s.holivita.ai) has no API to poll on a
// schedule. Its only "Ссылки" view lives behind a login-gated Streamlit
// admin panel (s-admin.holivita.ai) meant for a human to read, so this
// endpoint is called manually (a short script, after reading the current
// numbers from that panel) rather than automatically every night.
// Protected by SHORTLINK_API_SECRET (a Vercel env var) so randoms can't
// write fake click counts.
module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }
  const auth = req.headers['authorization'] || '';
  if (!process.env.SHORTLINK_API_SECRET || auth !== `Bearer ${process.env.SHORTLINK_API_SECRET}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
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
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {
        body = {};
      }
    }
    const date = (body && body.date) || new Date().toISOString().slice(0, 10);
    const links = (body && body.links) || [];
    if (!Array.isArray(links) || !links.length) {
      return res.status(400).json({ error: 'links array required' });
    }
    let written = 0;
    for (const l of links) {
      if (!l || !l.code) continue;
      await sql`
        INSERT INTO shortlink_snapshots (code, snapshot_date, clicks, source, medium, campaign)
        VALUES (${l.code}, ${date}, ${l.clicks || 0}, ${l.source || null}, ${l.medium || null}, ${l.campaign || null})
        ON CONFLICT (code, snapshot_date)
        DO UPDATE SET clicks = EXCLUDED.clicks, source = EXCLUDED.source, medium = EXCLUDED.medium, campaign = EXCLUDED.campaign
      `;
      written++;
    }
    res.status(200).json({ ok: true, date, written });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
