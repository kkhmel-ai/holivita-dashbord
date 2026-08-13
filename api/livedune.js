const https = require('https');
const agent = new https.Agent({ rejectUnauthorized: false });

module.exports = async (req, res) => {
  const TOKEN = process.env.LIVEDUNE_TOKEN;
  const qp = {...(req.query||{})};
  const customPath = qp._path;
  delete qp._path;
  delete qp['_vercel_no_cache'];

  const path = customPath || '/accounts/';
  const finalPath = path.endsWith('/') ? path : path+'/';
  const qs = new URLSearchParams(qp);
  qs.set('access_token', TOKEN);

  const url = 'https://api.livedune.com'+finalPath+'?'+qs;

  return new Promise((resolve) => {
    https.get(url, {agent}, (r) => {
      let data = '';
      r.on('data', c => data += c);
      r.on('end', () => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.status(r.statusCode).send(data);
        resolve();
      });
    }).on('error', (e) => {
      res.status(500).json({error: e.message});
      resolve();
    });
  });
};
