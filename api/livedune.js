const https = require('https');
const agent = new https.Agent({ rejectUnauthorized: false });

module.exports = async (req, res) => {
  const TOKEN = process.env.LIVEDUNE_TOKEN;
  const qp = req.query || {};
  const customPath = qp._path;
  delete qp._path;
  delete qp['_vercel_no_cache'];
  
  let path = customPath || '/accounts/';
  if (!path.endsWith('/')) path += '/';
  
  const qs = new URLSearchParams(qp);
  qs.set('access_token', TOKEN);
  
  const fullUrl = 'https://api.livedune.com' + path + '?' + qs;

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
      res.status(500).json({ error: e.message });
      resolve();
    });
  });
};
