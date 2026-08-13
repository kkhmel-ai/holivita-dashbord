const https = require('https');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (r) => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch(e) { resolve({}); }
      });
    }).on('error', reject);
  });
}

module.exports = async (req, res) => {
  const TOKEN = process.env.META_PAGE_TOKEN;
  const PAGE_ID = process.env.META_PAGE_ID;
  const IG_ID = process.env.META_IG_ID;
  const BASE = 'https://graph.facebook.com/v25.0';

  try {
    const [page, ig, igMedia] = await Promise.all([
      get(`${BASE}/${PAGE_ID}?fields=name,fan_count,followers_count&access_token=${TOKEN}`),
      get(`${BASE}/${IG_ID}?fields=username,followers_count,media_count&access_token=${TOKEN}`),
      get(`${BASE}/${IG_ID}/media?fields=id,timestamp,like_count,comments_count,reach,impressions,engagement&limit=20&access_token=${TOKEN}`),
    ]);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ page, ig, igMedia: igMedia.data || [] });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
