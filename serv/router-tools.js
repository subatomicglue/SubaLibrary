const fs = require('./FileSystem');
const path = require( 'path' );
const express = require( "express" );
const router = express.Router();
const markdown = require( "./markdown" );


function toolsPageVars(req, app_name, t=new Date() ) {
  const assets_magic = req.staticMode ? "assets" : require('./settings').ASSETS_MAGIC;

  return {
    ...require('./settings'), ...{ CANONICAL_URL: req.canonicalUrl, CANONICAL_URL_ROOT: req.canonicalUrlRoot, CANONICAL_URL_DOMAIN: req.canonicalUrlDomain, CURRENT_DATETIME: t.toISOString().replace(/\.\d{3}Z$/, '+0000') },
    TITLE: `${require('./settings').TITLE}`,
    SOCIAL_TITLE: `${require('./settings').TITLE} - ${req.baseUrl}${app_name != "" ? "/" + app_name : ''}`,
    SOCIAL_IMAGE: `${req.canonicalUrlRoot}/${assets_magic}/${require('./settings').SOCIAL_IMAGE}`, // Default social image path
    BACKBUTTON_PATH: `/`,
    BACKBUTTON_VISIBILITY: `visible`,//`hidden`,
    BACKBUTTON_IMAGE: `/${assets_magic}/home_24dp_E3E3E3_FILL0_wght400_GRAD0_opsz24.svg`,
    PAGE_TITLE: `<a href="${req.baseUrl}">${req.baseUrl}</a>${app_name != "" ? `/<a href="${app_name}">${app_name}</a>` : ''}`,
    USER: `${req.user}`,
    SCROLL_CLASS: "scroll-child-wiki",
    WHITESPACE: "normal",
    REQ_BASEURL: req.baseUrl,
    SEARCH_URL: `${req.baseUrl}/search`,
    SEARCH: `<span id="search" onclick='search()'><img src="/${assets_magic}/search_24dp_E3E3E3_FILL0_wght400_GRAD0_opsz24.svg" alt="[search]" title="[search]"></span>`,
    USER_LOGOUT: ``,
    ASSETS_MAGIC: assets_magic
  };
}
function generateToolPage( req, func, desc ) {
  const protocol = req.protocol;               // 'http' or 'https'
  const host = req.get('host');                // example.com or example.com:3000
  const domain = `${protocol}://${host}`;
  const pageHTML = require("./template").file( "template.page.html", {
    ...toolsPageVars(req, `${func}`),
    CANONICAL_URL_ROOT: domain,
    BODY: require("./template").file( "./template.string-function.html", {
      ...toolsPageVars(req, `${func}`),
      function_name: func,
      function_code: `<%include "tools-${func}.js"%>`,
      DESCRIPTION: desc
    })
  })
  return pageHTML
}

function createTool(func, desc) {
  module.exports.toolDescs = module.exports.toolDescs || {};
  module.exports.toolDescs[func] = desc;

  router.get(`/${func}`, (req, res) => {
    try {
      //return res.send("tools!");
      return res.send( generateToolPage( req, func, desc ) );
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  });
}

// debugging anything that hits this router...
router.use((req, res, next) => {
  console.log(`[tools] diagnostic: ${req.method} ${req.originalUrl}`);
  next();
});


/**
 * Scan current directory (or optionally a folder) for "tools-*.js" files
 * and return a Markdown list of bullets.
 * 
 * @param {string} dirPath - Optional directory path to scan. Defaults to current directory.
 * @returns {string} Markdown string with bullets
 */
function generateListOfTools(req, dirPath = '.') {
  const files = fs.readdirSync(dirPath);
  const toolFiles = files.filter(f => /^tools-.*\.js$/.test(f));
  const md = toolFiles.map(f => {
    const toolName = f.replace(/^tools-/, '').replace(/\.js$/, '');
    return `- [${toolName}](/tools/${toolName})`;
  }).join('\n');

  const protocol = req.protocol;               // 'http' or 'https'
  const host = req.get('host');                // example.com or example.com:3000
  const domain = `${protocol}://${host}`;
  const pageHTML = require("./template").file( "template.page.html", {
    ...toolsPageVars(req, ``),
    CANONICAL_URL_ROOT: domain,
    BODY: markdown.markdownToHtml( md, req.baseUrl )
  })
  return pageHTML
}

// info
router.get('/', (req, res) => {
  // return res.send('Server Error');
  //const BASE_URL = req.headers['host'] + "/rss";//`http${req.connection.localPort == HTTPS_PORT ? 's' : ''}://hypatiagnostikoi.com${HTTPS_PORT != 443 ? `:${HTTPS_PORT}` : ``}/rss`;
  console.log( `[tools] info`)
  try {
    res.send( generateListOfTools(req) );
  } catch (err) {
    console.error(`[tools] ip: ${req.ip} Error serving ${req.baseUrl}`, err);
    res.status(500).send('Server Error');
  }
});

///////////////////////////////////////////////////////////////////////////////////////
// register tools as router endpoints
createTool( "youtubeTranscriptCleanup", "Copy/paste a transcription from YouTube.  Hit Submit to clean it up" );
///////////////////////////////////////////////////////////////////////////////////////


function init( l ) {
  logger = l;
}

// Plug into Express
module.exports.router = router;
module.exports.init = init;
module.exports.generateListOfTools = generateListOfTools;
module.exports.generateToolPage = generateToolPage;
//module.exports.toolDescs = { toolname: desc };
