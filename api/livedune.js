const https = require('https');
const agent = new https.Agent({ rejectUnauthorized: false });

module.exports = async (req, res) => {
  const TOKEN = process.env.LIVEDUNE_TOKEN;
  const qp = {...(req.query||{})};
  const customPath = qp._path;
  delete qp._path;
  delete qp['_vercel_no_cache'];

  // Only the default accounts list needs a trailing slash. Custom sub-resource
  // paths (e.g. /accounts/{id}/posts) must be sent EXACTLY as given — LiveDune
  // does not match a trailing slash on those and silently falls back to the
  // accounts list, which was making posts/ER/top-posts always empty.
  const finalPath = customPath || '/accounts/';
  const qs = new URLSearchParams(qp);
  qs.set('access_token', TOKEN);

  const url = 'https://api.livedune.com'+finalPath+'?'+qs;

  if (req.query && req.query._debug) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json({
      debug: true,
      rawReqQuery: req.query,
      customPath: customPath,
      finalPath: finalPath,
      constructedUrl: url.replace(TOKEN, 'REDACTED')
    });
    return;
  }

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
