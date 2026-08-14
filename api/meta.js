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
      // reach/impressions/engagement are left out here on purpose — nothing
      // in the front end reads them off igMedia (ER/reach for Instagram
      // comes from LiveDune's own posts data instead), so there's no reason
      // to widen the fields list and risk the whole /media call failing if
      // a field ever needs a permission this token lacks.
      safe(get(`${BASE}/${IG_ID}/media?fields=id,timestamp,like_count,comments_count,caption,permalink,media_url,thumbnail_url&limit=20&access_token=${TOKEN}`)),
    ]);

    // Audience demographics — one Graph API call per breakdown dimension.
    // Meta requires >=100 followers for any of these to return real data;
    // below that threshold, or without the right permission, this just
    // comes back empty rather than erroring.
    // NOTE on Facebook Page geo demographics: page_fans_country/city/locale
    // were confirmed (via earlier ?debug=1 testing) to be outright rejected
    // by Meta with "(#100) The value must be a valid insights metric" — those
    // old metric names are dead. Meta's Nov 2025 metrics deprecation replaced
    // them with page_follows_country / page_follows_city (no replacement was
    // ever shipped for gender/age or locale — those are gone for good), so we
    // try the new names below instead of hardcoding FB as unavailable.
    // First attempt (page_follows_country/city with no date range) came back
    // as valid-but-empty (data: []) — not a permission/name error, just no
    // rows. Widening to an explicit 90-day since/until window in case the
    // default window is too narrow, plus trying the breakdown-param style
    // (like Instagram's follower_demographics) as a fallback candidate.
    const today = new Date();
    const since90 = new Date(today.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const untilToday = today.toISOString().slice(0, 10);
    const [igAge, igGender, igCountry, fbCountry, fbCity, fbFansCountryBd] = await Promise.all([
      safe(get(`${BASE}/${IG_ID}/insights?metric=follower_demographics&metric_type=total_value&period=lifetime&breakdown=age&access_token=${TOKEN}`)),
      safe(get(`${BASE}/${IG_ID}/insights?metric=follower_demographics&metric_type=total_value&period=lifetime&breakdown=gender&access_token=${TOKEN}`)),
      safe(get(`${BASE}/${IG_ID}/insights?metric=follower_demographics&metric_type=total_value&period=lifetime&breakdown=country&access_token=${TOKEN}`)),
      safe(get(`${BASE}/${PAGE_ID}/insights?metric=page_follows_country&period=day&since=${since90}&until=${untilToday}&access_token=${TOKEN}`)),
      safe(get(`${BASE}/${PAGE_ID}/insights?metric=page_follows_city&period=day&since=${since90}&until=${untilToday}&access_token=${TOKEN}`)),
      safe(get(`${BASE}/${PAGE_ID}/insights?metric=page_fans&metric_type=total_value&period=lifetime&breakdown=country&access_token=${TOKEN}`)),
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
    function pickPageMapMetric(resp) {
      // Shape: { data: [{ values: [{ value: { "US": 123, "GB": 45, ... }, end_time }] }] }
      // page_follows_country/city are daily time-series of a country->count
      // (or city->count) map. Scan from the newest day backwards for the
      // first non-empty snapshot, since the very latest day can legitimately
      // be an empty {} if the metric hasn't rolled up yet.
      try {
        const vals = resp.data && resp.data[0] && resp.data[0].values;
        if (!Array.isArray(vals) || !vals.length) return null;
        for (let i = vals.length - 1; i >= 0; i--) {
          const v = vals[i].value;
          if (v && typeof v === 'object') {
            const keys = Object.keys(v);
            if (keys.length) return keys.map(k => ({ key: k, value: v[k] }));
          }
        }
        return null;
      } catch (e) { return null; }
    }

    const demographics = {
      ig: {
        age: pickBreakdown(igAge),
        gender: pickBreakdown(igGender),
        country: pickBreakdown(igCountry),
      },
      fb: {
        country: pickPageMapMetric(fbCountry) || pickBreakdown(fbFansCountryBd),
        city: pickPageMapMetric(fbCity),
        // Meta discontinued page_fans_gender_age in Nov 2025 with no
        // replacement metric — genuinely not obtainable via API anymore.
        noAgeGender: true,
      },
    };
    if (req.query && req.query.fbdebug) {
      demographics.fb._debugRaw = { fbCountry, fbCity, fbFansCountryBd };
    }

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
    res.status(200).json({
      page, ig, igMedia: (igMedia && igMedia.data) || [],
      demographics,
      comments: { instagram: igCommentsFlat, facebook: fbCommentsFlat },
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
};
