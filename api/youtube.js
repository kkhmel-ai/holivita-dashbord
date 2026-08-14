const https = require('https');

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => {
        try {
          resolve(JSON.parse(d));
        } catch (e) {
          reject(new Error('YouTube API returned invalid JSON: ' + e.message));
        }
      });
    }).on('error', reject);
  });
}

// commentThreads.list works with a plain API key for public read-only
// comments (only moderationStatus filtering needs OAuth), so this is a
// no-extra-setup win. Best-effort per video — comments can be disabled on
// a video, which shouldn't break the rest of the response.
async function safe(promise) {
  try { return await promise; }
  catch (e) { return { error: e.message }; }
}

// Pulls subscriber count + recent video stats directly from the official,
// free YouTube Data API v3, so we don't depend on LiveDune for this
// platform. Needs YOUTUBE_API_KEY and YOUTUBE_CHANNEL_ID env vars.
module.exports = async (req, res) => {
  const KEY = process.env.YOUTUBE_API_KEY;
  const CHANNEL_ID = process.env.YOUTUBE_CHANNEL_ID;
  if (!KEY || !CHANNEL_ID) {
    return res.status(500).json({ error: 'YOUTUBE_API_KEY or YOUTUBE_CHANNEL_ID not configured' });
  }
  try {
    const chan = await get(
      `https://www.googleapis.com/youtube/v3/channels?part=statistics,contentDetails&id=${CHANNEL_ID}&key=${KEY}`
    );
    const item = (chan.items || [])[0];
    if (!item) {
      return res.status(404).json({ error: 'Channel not found', details: chan });
    }
    const stats = item.statistics || {};
    const uploadsPlaylist =
      item.contentDetails &&
      item.contentDetails.relatedPlaylists &&
      item.contentDetails.relatedPlaylists.uploads;

    let videos = [];
    if (uploadsPlaylist) {
      const pl = await get(
        `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails,snippet&playlistId=${uploadsPlaylist}&maxResults=25&key=${KEY}`
      );
      const videoIds = (pl.items || []).map((i) => i.contentDetails.videoId).filter(Boolean).join(',');
      if (videoIds) {
        const vids = await get(
          `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${videoIds}&key=${KEY}`
        );
        // Shaped to match the same fields the front end already reads off
        // LiveDune posts (created / reactions.likes+comments / impressions.total)
        // so it slots into the existing rendering code with no extra changes.
        videos = (vids.items || []).map((v) => ({
          id: v.id,
          created: (v.snippet.publishedAt || '').replace('T', ' ').replace('Z', ''),
          text: v.snippet.title,
          url: 'https://youtube.com/watch?v=' + v.id,
          thumbnail:
            v.snippet.thumbnails &&
            (v.snippet.thumbnails.medium || v.snippet.thumbnails.default || {}).url,
          reactions: {
            likes: parseInt(v.statistics.likeCount || 0, 10),
            comments: parseInt(v.statistics.commentCount || 0, 10),
          },
          impressions: { total: parseInt(v.statistics.viewCount || 0, 10) },
        }));
      }
    }

    // Latest comments across the most recent videos — cheap (1 quota unit
    // per call) and works with the same API key, no OAuth needed.
    const topVideos = videos.slice(0, 5);
    const commentResults = await Promise.all(topVideos.map((v) =>
      safe(get(
        `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${v.id}&maxResults=5&order=time&key=${KEY}`
      ))
    ));
    const comments = commentResults.flatMap((r, i) =>
      ((r && r.items) || []).map((c) => {
        const s = c.snippet.topLevelComment.snippet;
        return {
          text: s.textDisplay, author: s.authorDisplayName, time: s.publishedAt,
          likes: s.likeCount || 0, postId: topVideos[i].id, postCaption: topVideos[i].text,
        };
      })
    ).sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 10);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      subscriberCount: parseInt(stats.subscriberCount || 0, 10),
      viewCount: parseInt(stats.viewCount || 0, 10),
      videoCount: parseInt(stats.videoCount || 0, 10),
      videos,
      comments,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
