async function siteMap(baseUrl) {
  const xml = [
    ...(await require("./router-wiki").getSitemapEntries( baseUrl, require('./settings').WIKI_ENDPOINT ))
  ].map(
    (item) => `
    <url>
      <loc>${item.url}</loc>
      <lastmod>${item.lastmod}</lastmod>
      <changefreq>${item.changefreq}</changefreq>
      <priority>${item.priority}</priority>
    </url>`
  ).join("\n");

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
  <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    ${xml}
  </urlset>`;

  return sitemap;
}

module.exports.siteMap = siteMap;
