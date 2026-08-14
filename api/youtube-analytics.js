const https = require('https');

function post(url, body) {
  return new Promise((resolve, reject) => {
    const data = new URLSearchParams(body).toString();
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(data) },
    }, (r) => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({}); } });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (r) => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({}); } });
    }).on('error', reject);
  });
}

function fmt(d) { return d.toISOString().slice(0, 10); }

// YouTube Analytics (watch time, average view duration, subscribers
// gained/lost, traffic sources) is NOT available via a plain API key — it
// requires OAuth 2.0 user authorization. This endpoint expects a one-time-
// obtained refresh token (via Google's OAuth 2.0 Playground, see setup docs)
// stored in YOUTUBE_REFRESH_TOKEN, plus the OAuth client's own
// YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET. Until those three env vars are
// set, this responds with configured:false instead of erroring, so the
// front end can show a friendly "not set up yet" state.
module.exports = async (req, res) => {
  const CLIENT_ID = process.env.YOUTUBE_CLIENT_ID;
  const CLIENT_SECRET = process.env.YOUTUBE_CLIENT_SECRET;
  const REFRESH_TOKEN = process.env.YOUTUBE_REFRESH_TOKEN;
  const CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN || !CHANNEL_ID) {
    return res.status(200).json({ configured: false });
  }

  try {
    const tok = await post('https://oauth2.googleapis.com/token', {
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      refresh_token: REFRESH_TOKEN, grant_type: 'refresh_token',
    });
    if (!tok.access_token) {
      return res.status(200).json({ configured: true, error: 'Не удалось обновить access token', details: tok });
    }
    const access = tok.access_token;
    const to = new Date(), from = new Date(to);
    from.setDate(to.getDate() - 30);
    const startDate = fmt(from), endDate = fmt(to);
    const base = 'https://youtubeanalytics.googleapis.com/v2/reports';

    const [totals, traffic, daily] = await Promise.all([
      get(`${base}?ids=channel==${CHANNEL_ID}&startDate=${startDate}&endDate=${endDate}&metrics=views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost&access_token=${access}`),
      get(`${base}?ids=channel==${CHANNEL_ID}&startDate=${startDate}&endDate=${endDate}&metrics=views&dimensions=insightTrafficSourceType&sort=-views&access_token=${access}`),
      get(`${base}?ids=channel==${CHANNEL_ID}&startDate=${startDate}&endDate=${endDate}&metrics=views,subscribersGained,subscribersLost&dimensions=day&sort=day&access_token=${access}`),
    ]);

    const t = (totals.rows && totals.rows[0]) || [];
    res.status(200).json({
      configured: true,
      range: { from: startDate, to: endDate },
      totals: {
        views: t[0] || 0,
        estimatedMinutesWatched: t[1] || 0,
        averageViewDuration: t[2] || 0,
        subscribersGained: t[3] || 0,
        subscribersLost: t[4] || 0,
      },
      trafficSources: (traffic.rows || []).map(r => ({ source: r[0], views: r[1] })),
      daily: (daily.rows || []).map(r => ({ date: r[0], views: r[1], gained: r[2], lost: r[3] })),
    });
  } catch (e) {
    res.status(200).json({ configured: true, error: e.message });
  }
};
