const https = require('https');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (r) => {
      let d = '';
      r.on('data', c => d += c);
      r.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch(e) { resolve({}); }
      });
    }).on('error', reject);
  });
}

// Never let one failing/unauthorized metric take down the whole response —
// missing scopes (e.g. instagram_manage_comments not granted) or metrics
// Meta has deprecated should just come back empty, not break the endpoint.
async function safe(promise) {
  try { return await promise; }
  catch (e) { return { error: e.message }; }
}

module.exports = async (req, res) => {
  const TOKEN = process.env.META_PAGE_TOKEN;
  const PAGE_ID = process.env.META_PAGE_ID;
  const IG_ID = process.env.META_IG_ID;
  const BASE = 'https://graph.facebook.com/v25.0';

  try {
    const [page, ig, igMedia] = await Promise.all([
      safe(get(`${BASE}/${PAGE_ID}?fields=name,fan_count,followers_count&access_token=${TOKEN}`)),
      safe(get(`${BASE}/${IG_ID}?fields=username,followers_count,media_count&access_token=${TOKEN}`)),
      // reach/impressions/engagement were dropped from this fields list —
      // they require the instagram_manage_insights permission, which this
      // app/token doesn't currently have (confirmed via ?debug=1: error #10
      // "Application does not have permission for this action"). Without
      // them the whole /media call was failing and returning nothing at all
      // (Graph API rejects the entire fields list if one field needs a
      // missing permission), which is why comments were empty too — there
      // was no media list to pull comments from.
      safe(get(`${BASE}/${IG_ID}/media?fields=id,timestamp,like_count,comments_count,caption,permalink,media_url,thumbnail_url&limit=20&access_token=${TOKEN}`)),
    ]);

    // Audience demographics — one Graph API call per breakdown dimension.
    // Meta requires >=100 followers for any of these to return real data;
    // below that threshold, or without the right permission, this just
    // comes back empty rather than erroring.
    // NOTE on Facebook Page geo demographics (page_fans_country/city/locale):
    // confirmed via ?debug=1 that Meta now rejects these outright with
    // "(#100) The value must be a valid insights metric" — they've been
    // removed from the API, not just permission-gated, so we no longer
    // call them at all (dead end regardless of permissions).
    const [igAge, igGender, igCountry] = await Promise.all([
      safe(get(`${BASE}/${IG_ID}/insights?metric=follower_demographics&metric_type=total_value&period=lifetime&breakdown=age&access_token=${TOKEN}`)),
      safe(get(`${BASE}/${IG_ID}/insights?metric=follower_demographics&metric_type=total_value&period=lifetime&breakdown=gender&access_token=${TOKEN}`)),
      safe(get(`${BASE}/${IG_ID}/insights?metric=follower_demographics&metric_type=total_value&period=lifetime&breakdown=country&access_token=${TOKEN}`)),
    ]);

    function pickBreakdown(resp) {
      // Shape: { data: [{ total_value: { breakdowns: [{ results: [{dimension_values:[...], value}] }] } }] }
      try {
        const tv = resp.data && resp.data[0] && resp.data[0].total_value;
        const results = tv && tv.breakdowns && tv.breakdowns[0] && tv.breakdowns[0].results;
        if (!Array.isArray(results)) return null;
        return results.map(r => ({ key: (r.dimension_values || []).join(' '), value: r.value }));
      } catch (e) { return null; }
    }
    function pickLifetimeMetric(resp, name) {
      try {
        const m = (resp.data || []).find(d => d.name === name);
        return m && m.values && m.values[0] && m.values[0].value || null;
      } catch (e) { return null; }
    }

    const demographics = {
      ig: {
        age: pickBreakdown(igAge),
        gender: pickBreakdown(igGender),
        country: pickBreakdown(igCountry),
      },
      fb: { unavailable: true }, // Meta removed page_fans_country/city/locale — no longer callable at all.
    };

    // Latest comments — best effort. IG media comments need the extra
    // instagram_manage_comments permission (not just insights), so this may
    // legitimately come back empty if the connected token wasn't granted it.
    const topIgMedia = ((igMedia && igMedia.data) || []).slice(0, 5);
    const igComments = await Promise.all(topIgMedia.map(m =>
      safe(get(`${BASE}/${m.id}/comments?fields=text,username,timestamp,like_count&limit=5&access_token=${TOKEN}`))
    ));
    const igCommentsFlat = igComments.flatMap((c, i) =>
      ((c && c.data) || []).map(cm => ({
        text: cm.text, author: cm.username, time: cm.timestamp,
        likes: cm.like_count || 0, postId: topIgMedia[i] && topIgMedia[i].id,
        postCaption: (topIgMedia[i] && topIgMedia[i].caption || '').slice(0, 60),
      }))
    ).sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 10);

    const fbPosts = await safe(get(`${BASE}/${PAGE_ID}/posts?fields=id,message,created_time&limit=5&access_token=${TOKEN}`));
    const topFbPosts = ((fbPosts && fbPosts.data) || []);
    const fbComments = await Promise.all(topFbPosts.map(p =>
      safe(get(`${BASE}/${p.id}/comments?fields=message,from,created_time,like_count&limit=5&access_token=${TOKEN}`))
    ));
    const fbCommentsFlat = fbComments.flatMap((c, i) =>
      ((c && c.data) || []).map(cm => ({
        text: cm.message, author: cm.from && cm.from.name, time: cm.created_time,
        likes: cm.like_count || 0, postId: topFbPosts[i] && topFbPosts[i].id,
        postCaption: (topFbPosts[i] && topFbPosts[i].message || '').slice(0, 60),
      }))
    ).sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 10);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    const out = {
      page, ig, igMedia: (igMedia && igMedia.data) || [],
      demographics,
      comments: { instagram: igCommentsFlat, facebook: fbCommentsFlat },
    };
    // Temporary: expose the raw Graph API responses for the demographics
    // calls when they came back empty, so we can see the actual error
    // (permission/scope/deprecation) instead of guessing. Remove once
    // diagnosed.
    if (req.query && req.query.debug) {
      out._debugRaw = { igAge, igGender, igCountry, igMediaRaw: igMedia };
    }
    res.status(200).json(out);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
