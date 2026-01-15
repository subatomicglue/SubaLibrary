const express = require('express');
const fs = require('./FileSystem');
const path = require('path');
const { HTTPS_PORT } = require('./settings');
const sanitizer = require('./sanitizer');
const sanitize = sanitizer.sanitize;

const router = express.Router();

const {
  TITLE,
  TORRENT_DIR,
} = require('./settings');

function makeRSS(base_url, torrent_dir) {
  const files = fs.readdirSync(torrent_dir)
      .filter(f => f.endsWith('.torrent'))
      .map(f => {
        const stats = fs.statSync(path.join(torrent_dir, f));
        return { name: f, mtime: stats.mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);

  // this is XML, not HTML (link needs a closing tag in XML, where in HTML link has no closing tag - is a void element)
  const items = files.map(({ name, mtime }) => `
    <item>
      <title>${name}</title>
      <link>${base_url}/${encodeURIComponent(name)}</link>
      <guid isPermaLink="true">${base_url}/${encodeURIComponent(name)}</guid>
      <pubDate>${mtime.toUTCString()}</pubDate>
    </item>
  `).join('\n');

  const rss = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
  <channel>
    <title>${TITLE} Torrent Feed</title>
    <link>${base_url}</link>
    <description>All torrents for ${base_url}</description>
    ${items}
  </channel>
</rss>`;
  return rss
}

router.get('/', (req, res) => {
  // return res.send('Server Error');
  //const BASE_URL = req.headers['host'] + "/rss";//`http${req.connection.localPort == HTTPS_PORT ? 's' : ''}://hypatiagnostikoi.com${HTTPS_PORT != 443 ? `:${HTTPS_PORT}` : ``}/rss`;
  console.log( `[rss] ip: ${req.ip} GET feed`)
  try {
    const protocol = req.protocol;   // 'http' or 'https'
    const host = req.get('host');    // e.g., 'hypatiagnostikoi.com' or 'localhost:3000'
    
    // Dynamically generate the base URL
    const BASE_URL = `${protocol}://${host}/rss`;

    const rss = makeRSS(BASE_URL, TORRENT_DIR);

    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', 'application/rss+xml');
    res.send(rss);
  } catch (err) {
    console.error(`[rss] ip: ${req.ip} Error building RSS feed:`, err);
    res.status(500).send('Server Error');
  }
});

// Torrent file download route
router.get('/:filename', (req, res) => {
  // return res.send('Server Error');

  const filePath = sanitize(TORRENT_DIR, req.params.filename);
  console.log( `[rss] ip: ${req.ip} GET: ${filePath.relPath}`)

  if (!filePath.fullPath.endsWith('.torrent')) {
    return res.status(400).send('Invalid file type requested');
  }

  if (!fs.existsSync(filePath.fullPath)) {
    console.error(`[rss] ip: ${req.ip} 404: ${filePath.relPath} not found`);
    return res.status(404).send('Not Found');
  }

  res.setHeader('Content-Type', 'application/x-bittorrent');
  res.setHeader('Content-Disposition', `attachment; filename="${filePath.relPath}"`);
  res.sendFile(filePath.fullPath);
});

let logger;
function init( l ) {
  logger = l;
}

module.exports.router = router;
module.exports.init = init;
module.exports.makeRSS = makeRSS;
