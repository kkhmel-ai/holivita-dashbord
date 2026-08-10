const https = require('https');

const TOKEN = process.env.LIVEDUNE_TOKEN;
const BASE_HOST = 'api.livedune.com';
const agent = new https.Agent({ rejectUnauthorized: false });

exports.handler = async (event) => {
  const rawPath = event.path || '';
  const rawQuery = event.queryStringParameters || {};
  
  const qs = new URLSearchParams(rawQuery);
  qs.set('access_token', TOKEN);
  
  const url = `https://${BASE_HOST}/accounts/?${qs}`;

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
        body: JSON.stringify({ error: e.message, url, rawPath }),
      });
    });
  });
};
