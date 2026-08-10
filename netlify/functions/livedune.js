const https = require('https');

const TOKEN = process.env.LIVEDUNE_TOKEN;
const BASE_HOST = 'api.livedune.ru';

exports.handler = async (event) => {
  const path = event.path.replace('/.netlify/functions/livedune', '') || '/accounts';
  const qs = new URLSearchParams(event.queryStringParameters || {});
  qs.set('access_token', TOKEN);
  const url = `https://${BASE_HOST}${path}?${qs}`;

  return new Promise((resolve) => {
    https.get(url, (res) => {
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
    }).on('error', (e) => {
      resolve({
        statusCode: 500,
        body: JSON.stringify({ error: e.message }),
      });
    });
  });
};
