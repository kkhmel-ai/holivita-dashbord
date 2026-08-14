const https = require('https');
const { sql } = require('@vercel/postgres');
const agent = new https.Agent({ rejectUnauthorized: false });

// Fetches the current account list from LiveDune (same endpoint the main
// dashboard uses) so we can record a daily snapshot of follower counts.
// LiveDune's own date_from/date_to filters on /accounts/ don't return real
// historical data (always returns current numbers), so we keep our own
// history by calling this once a day via Vercel Cron (see vercel.json).
function fetchAccounts() {
  return new Promise((resolve, reject) => {
    const TOKEN = process.env.LIVEDUNE_TOKEN;
    const url = 'https://api.livedune.com/accounts/?access_token=' + TOKEN;
    https.get(url, { agent }, (r) => {
      let data = '';
      r.on('data', (c) => (data += c));
      r.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error('LiveDune returned invalid JSON: ' + e.message));
        }
      });
    }).on('error', reject);
  });
}

module.exports = async (req, res) => {
  // Optional protection: if CRON_SECRET is set in env vars, require it on
  // manual calls (Vercel's own Cron invocations are authenticated separately
  // and always allowed).
  const isVercelCron = !!req.headers['x-vercel-cron'] || !!req.headers['x-vercel-cron-signature'];
  if (process.env.CRON_SECRET && !isVercelCron) {
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }

  try {
    await sql`CREATE TABLE IF NOT EXISTS follower_snapshots (
      account_id BIGINT NOT NULL,
      snapshot_date DATE NOT NULL,
      followers INTEGER NOT NULL,
      platform TEXT,
      PRIMARY KEY (account_id, snapshot_date)
    )`;

    const data = await fetchAccounts();
    const accounts = data.response || [];
    const today = new Date().toISOString().slice(0, 10);

    let written = 0;
    for (const a of accounts) {
      const followers = (a.stat && a.stat.followers) || a.followers || a.subscribers || 0;
      await sql`
        INSERT INTO follower_snapshots (account_id, snapshot_date, followers, platform)
        VALUES (${a.id}, ${today}, ${followers}, ${a.type})
        ON CONFLICT (account_id, snapshot_date)
        DO UPDATE SET followers = EXCLUDED.followers
      `;
      written++;
    }

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true, date: today, accounts: written });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
