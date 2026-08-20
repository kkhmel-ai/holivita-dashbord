const https = require('https');

// X/Twitter always wraps any link a user pastes into a post with its own
// t.co shortener before returning it via any API — LiveDune's post "text"
// field shows only the t.co URL, never the original s.holivita.ai link the
// team actually pasted. To attribute X posts to UTM clicks the same way we
// do for Facebook/Telegram (where the s.holivita.ai link is visible in the
// text as-is), we have to unwrap t.co ourselves: follow its HTTP redirect
// and read the destination out of the Location header. This is exactly what
// every Twitter client and every link-preview tool does automatically —
// it's just reading a public redirect, not scraping any content.
function resolveOne(code) {
  return new Promise((resolve) => {
    const follow = (host, path, hops) => {
      if (hops > 5) return resolve(null);
      const req = https.request(
        { hostname: host, path, method: 'GET', timeout: 5000 },
        (r) => {
          const loc = r.headers.location;
          const status = r.statusCode;
          r.destroy(); // don't download the body — we only need headers
          if ((status === 301 || status === 302 || status === 303 || status === 307 || status === 308) && loc) {
            try {
              const u = new URL(loc, `https://${host}${path}`);
              follow(u.hostname, u.pathname + (u.search || ''), hops + 1);
            } catch (e) { resolve(null); }
          } else {
            resolve(`https://${host}${path}`);
          }
        }
      );
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.end();
    };
    follow('t.co', '/' + code, 0);
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  const codes = (req.query.codes || '').split(',').map((c) => c.trim()).filter(Boolean).slice(0, 80);
  const pairs = await Promise.all(codes.map(async (c) => [c, await resolveOne(c)]));
  const out = {};
  pairs.forEach(([c, u]) => { out[c] = u; });
  res.status(200).json(out);
};
