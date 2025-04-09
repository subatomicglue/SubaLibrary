const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const TORRENT_DIR = path.join(__dirname, 'torrents');
const BASE_URL = 'http://yourdomain.com/torrents';

router.get('/rss.xml', (req, res) => {
  try {
    const files = fs.readdirSync(TORRENT_DIR)
      .filter(f => f.endsWith('.torrent'))
      .map(f => {
        const stats = fs.statSync(path.join(TORRENT_DIR, f));
        return { name: f, mtime: stats.mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);

    const items = files.map(({ name, mtime }) => `
      <item>
        <title>${name}</title>
        <link>${BASE_URL}/${encodeURIComponent(name)}</link>
        <guid isPermaLink="true">${BASE_URL}/${encodeURIComponent(name)}</guid>
        <pubDate>${mtime.toUTCString()}</pubDate>
      </item>
    `).join('\n');

    const rss = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
  <channel>
    <title>My Auto-Sync Torrent Feed</title>
    <link>${BASE_URL}/</link>
    <description>Torrents updated from local files</description>
    ${items}
  </channel>
</rss>`;

    res.set('Content-Type', 'application/rss+xml');
    res.send(rss);
  } catch (err) {
    console.error('Error building RSS feed:', err);
    res.status(500).send('Failed to generate RSS feed');
  }
});

module.exports = router;
