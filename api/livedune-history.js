const https = require('https');
const agent = new https.Agent({ rejectUnauthorized: false });

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { agent }, (r) => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({ raw: d }); } });
    }).on('error', reject);
  });
}

// LiveDune's list-shaped responses vary by endpoint (response/data/items) —
// same defensive pattern already used for /accounts/{id}/posts.
function pickList(resp) {
  if (Array.isArray(resp)) return resp;
  if (Array.isArray(resp.response)) return resp.response;
  if (Array.isArray(resp.data)) return resp.data;
  if (Array.isArray(resp.items)) return resp.items;
  return [];
}
function pickDate(row) { return row.created || row.date || row.day || row.created_at || ''; }
function pickFollowers(row) {
  const v = row.followers ?? row.count ?? row.subscribers ?? row.value ?? null;
  return v == null ? null : parseInt(v, 10);
}

async function fetchHistory(accountId, token) {
  let all = [];
  let cursor = null;
  // Paginate defensively — LiveDune docs for this endpoint weren't fully
  // accessible, so we follow whatever cursor field comes back (after/next)
  // for a few pages and stop once there's nothing more or nothing new.
  for (let i = 0; i < 6; i++) {
    const qs = new URLSearchParams({ access_token: token });
    if (cursor) qs.set('after', cursor);
    const url = `https://api.livedune.com/accounts/${accountId}/history?${qs}`;
    let resp;
    try { resp = await get(url); } catch (e) { break; }
    const list = pickList(resp);
    if (!list.length) break;
    all = all.concat(list);
    const nextCursor = resp.after || resp.next || (resp.meta && resp.meta.after) || null;
    if (!nextCursor || nextCursor === cursor) break;
    cursor = nextCursor;
  }
  const days = all
    .map(row => ({ date: (pickDate(row) || '').slice(0, 10), followers: pickFollowers(row) }))
    .filter(d => d.date && d.followers != null);
  days.sort((a, b) => a.date.localeCompare(b.date));
  return { days, _sample: all[0] || null, _count: all.length };
}

module.exports = async (req, res) => {
  const TOKEN = process.env.LIVEDUNE_TOKEN;
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  try {
    let accountIds = [];
    if (req.query.account_id) {
      accountIds = [req.query.account_id];
    } else {
      const accResp = await get(`https://api.livedune.com/accounts/?access_token=${TOKEN}`);
      accountIds = pickList(accResp).map(a => a.id).filter(Boolean);
    }
    const results = await Promise.all(accountIds.map(id => fetchHistory(id, TOKEN)));
    const byAccount = {};
    accountIds.forEach((id, i) => { byAccount[id] = results[i]; });
    res.status(200).json({ accounts: byAccount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
