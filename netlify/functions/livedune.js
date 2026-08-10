const https = require('https');

const TOKEN = process.env.LIVEDUNE_TOKEN;
const BASE = 'https://api.livedune.com';
const agent = new https.Agent({ rejectUnauthorized: false });

exports.handler = async (event) => {
  let path = event.path
    .replace('/.netlify/functions/livedune', '')
    .replace('/api/livedune', '');
  
  if (!path || path === '/') path = '/accounts/';
  if (!path.endsWith('/')) path += '/';

  const qs = new URLSearchParams(event.queryStringParameters || {});
  qs.set('access_token', TOKEN);
  
  const url = `${BASE}${path}?${qs}`;

  return new Promise((resolve) => {
    const req = https.get(url, { agent }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
          body: data,
        });
      });
    });
    req.on('error', (e) => {
      resolve({
        statusCode: 500,
        body: JSON.stringify({ error: e.message, url }),
      });
    });
  });
};
