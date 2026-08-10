const https = require('https');
const agent = new https.Agent({ rejectUnauthorized: false });

module.exports = async (req, res) => {
  const TOKEN = process.env.LIVEDUNE_TOKEN;
  
  const fullPath = req.url || '';
  const path = fullPath.replace(/^\/api\/livedune/, '') || '/accounts/';
  const finalPath = path.endsWith('/') ? path : path + '/';
  
  const qs = new URLSearchParams(req.query || {});
  qs.delete('_vercel_no_cache');
  qs.set('access_token', TOKEN);
  
  const fullUrl = 'https://api.livedune.com' + finalPath + '?' + qs;

  return new Promise((resolve) => {
    https.get(fullUrl, { agent }, (r) => {
      let data = '';
      r.on('data', chunk => data += chunk);
      r.on('end', () => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json');
        res.status(r.statusCode).send(data);
        resolve();
      });
    }).on('error', (e) => {
      res.status(500).json({ error: e.message, url: fullUrl });
      resolve();
    });
  });
};
