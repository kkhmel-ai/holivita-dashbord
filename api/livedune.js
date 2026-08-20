const https = require('https');
const agent = new https.Agent({ rejectUnauthorized: false });

module.exports = async (req, res) => {
  const TOKEN = process.env.LIVEDUNE_TOKEN;
  const qp = {...(req.query||{})};
  // "path" is accepted as an alias for "_path" — some HTTP tooling (including
  // our own debugging fetches) silently strips query keys starting with an
  // underscore before the request goes out, which made this endpoint
  // impossible to test for anything but the default accounts list.
  const customPath = qp._path || qp.path;
  delete qp._path;
  delete qp.path;
  delete qp['_vercel_no_cache'];

  // Only the default accounts list needs a trailing slash. Custom sub-resource
  // paths (e.g. /accounts/{id}/posts) must be sent EXACTLY as given — LiveDune
  // does not match a trailing slash on those and silently falls back to the
  // accounts list, which was making posts/ER/top-posts always empty.
  const finalPath = customPath || '/accounts/';
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
