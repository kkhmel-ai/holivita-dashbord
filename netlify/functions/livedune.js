const TOKEN = process.env.LIVEDUNE_TOKEN;
const BASE = 'https://api.livedune.ru';

exports.handler = async (event) => {
  const path = event.path.replace('/.netlify/functions/livedune', '');
  const params = new URLSearchParams(event.queryStringParameters || {});
  params.set('access_token', TOKEN);
  try {
    const r = await fetch(`${BASE}${path}?${params}`);
    const body = await r.text();
    return {
      statusCode: r.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body
    };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
