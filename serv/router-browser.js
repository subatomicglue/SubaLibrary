const path = require('path');
const fs = require('fs');
const os = require('os');
const mime = require('mime-types');
const express = require("express");
const router = express.Router();
const sanitizer = require('./sanitizer');
const sanitize = sanitizer.sanitize;
const template = require('./template');

const {
  TITLE,
  PORT_DEFAULT,
  PUBLIC_DIR,
  LOGS_DIR,
  ASSETS_DIR,
  ALLOWED_EXTENSIONS,
  RATE_LIMIT_WINDOW_SECS,
  RATE_LIMIT_WINDOW_MAX_REQUESTS,
  MAX_PATH_LENGTH,
  USE_HTTPS,
  HTTPS_CERT_CRT,
  HTTPS_CERT_CSR,
  HTTPS_CERT_KEY,
  ALLOW_DOTFILES,
  VERBOSE,
  USERS_WHITELIST,
  SECRET_PASSCODE,
  PORT,
  ASSETS_MAGIC,
  isPM2,
} = require('./settings');

let logger; // init() sets this

// in our app, we want to treat symlink dirs and dirs as "dirs".
function isDir( path ) {
  try {
    if (fs.statSync(path).isDirectory()) {
      return true;
    }
    return false;
  } catch (error) {
    return false;
  }
}

// in our app, we want to treat files as "files".
function isFile( path ) {
  try {
    if (fs.statSync(path).isFile()) {
      return true;
    }
    return false;
  } catch (error) {
    return false;
  }
}

function userLogDisplay(req_user, req_ip) {
  return `[${req_user!=""?`${req_user}@`:""}${req_ip.replace(/^::ffff:/, '')}]`
}


// Function to get directory contents
function getDirectoryContents( rel_dir ) {
  try {
    const { relPath, fullPath, mimeType, ext } = sanitize( PUBLIC_DIR, rel_dir ); // ensure path is under PUBLIC_DIR, no shenanigans with "..", etc.
    if (!isDir( fullPath )) {
      logger.warn(`[error] : Not a directory: ${fullPath}`);
      return null; // Return null if inaccessible or an error occurs
    }

    // get the directory listing & return it
    const items = fs.readdirSync(fullPath, { withFileTypes: true });
    return items
      .map(item => {
        const s = sanitize( fullPath, item.name );
        return {
          name: item.name,
          isDirectory: item.isDirectory() || isDir( s.fullPath ), // item.isDirectory fails when symlink dir, but fs.statSync works.
          path: s.relPath,
          mimeType: s.mimeType,
          ext: s.ext
        }
      })
      .filter(item => {
        let is_sane = sanitize( fullPath, item.name ).relPath == item.name; // fullPath is sane already, but, the item.name may NOT be sane
        let is_sane_and_dir_or_goodtype = is_sane && (item.isDirectory || ALLOWED_EXTENSIONS.has(item.ext))
        if (!is_sane) {
          VERBOSE && logger.warn(`[listing] SKIPPING: Not an allowed path, sanitized: ${relPath}/${item.name} != ${sanitize( fullPath, item.name ).relPath}`);
        }
        return is_sane_and_dir_or_goodtype;
      })  // Only show allowed files
      .sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1));  // Sort directories first
  } catch (error) {
    logger.warn(`[error] : Error reading '${rel_dir}' -> ${error}`);
    return null; // Return null if inaccessible or an error occurs
  }
}


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// endpoints
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// general guard, filter anything unexpected or unsupported by the app
router.use((req, res, next) => {
  const req_path = decodeURIComponent( req.path )

  // wiki doesn't want these blocks... todo: refactor / separate using the express router as wiki.js has done.
  if (req_path.match( /^\/wiki/ )) {
    next();
    return
  }

  if (req.params[0] && req.params[0].length > MAX_PATH_LENGTH) {
    return res.status(500).json({ error: "Path length exceeded the limit." });
  }

  if (Object.keys(req.query).length > 0) {
    // for (let key in req.query) {
    //   if (req.query[key] && req.query[key].length > MAX_PATH_LENGTH) {
    //     return res.status(500).json({ error: `Query parameter '${key}' is too long` });
    //   }
    // }
    return res.status(500).json({ error: `Query parameter '${Object.keys(req.query)}' is too long >0` });
  }

  if (req.body && Object.keys(req.body).length > 0) {
  //for (let key in req.body) {
  //  if (req.body[key] && typeof req.body[key] === 'string' && req.body[key].length > MAX_PATH_LENGTH) {
  //    return res.status(500).json({ error: `Body parameter '${key}' is too long` });
  //  }
    return res.status(500).json({ error: `Body parameter '${Object.keys(req.body)}' is too long` });
  }

  let acceptable_headers = { 'content-type': ["application/x-www-form-urlencoded"] }
  if (req.headers['content-type'] && !acceptable_headers['content-type'].includes( req.headers['content-type'] )) {
    logger.warn(`[content-type BLOCK] : Unexpected headers detected -> content-type:${req.headers['content-type']}`);
    return res.status(500).json({ error: `Unexpected headers detected. ${JSON.stringify( Object.keys( req.headers ) )} ${req.headers['content-type']}` });
  }

  next();
});

// [browse] 1. Serve directory listing or 2. Serve Files, from under the PUBLIC_DIR (user input sanitized to ensure safety)
router.get('*', (req, res) => {
  const req_path = decodeURIComponent( req.path )
  logger.info(`[browse]   ${req_path}`);
  
  const sanitized = sanitize( PUBLIC_DIR, req_path )
  let asset_match_result = undefined;

  // get sanitized version of what's asked for:
  // ensure path is under PUBLIC_DIR, no shenanigans with "..", etc.
  const { relPath, fullPath, mimeType, ext, forceTypeAllowed } = 
    sanitized.relPath.match( /^\/?favicon\.ico$/ ) ? sanitize( ASSETS_DIR, "favicon.ico", { forceTypeAllowed: true } ) :
    ((asset_match_result = sanitized.relPath.match( new RegExp( `${ASSETS_MAGIC}(.*)$` ) )) && asset_match_result[1]) ? sanitize( ASSETS_DIR, asset_match_result[1], { forceTypeAllowed: true } ) :
    sanitized;
  logger.info(`[browse]   ${userLogDisplay(req.user, req.ip)} -> '${req_path}' -> '${fullPath}'`);
  if (fullPath == "" || path.resolve(fullPath) != fullPath) {
    logger.warn(`[error] ${userLogDisplay(req.user, req.ip)} -> 403 - Forbidden: ${fullPath}`);
    return res.status(403).send('403 - Forbidden');
  }

  try {
    // Check if the requested path exists
    fs.accessSync(fullPath);

    // if the path points at a file, serv that up:
    if (isFile( fullPath )) {
      logger.info(`[download] ${userLogDisplay(req.user, req.ip)} -> path:'${fullPath}' ext:'${ext}' mime:'${mimeType}'`);

      if (!ALLOWED_EXTENSIONS.has(ext) && !forceTypeAllowed) {
          logger.warn(`[error] ${req.ip} -> 403 - Forbidden: File type not allowed: ${fullPath} (${ext})`);
          return res.status(403).send('403 - Forbidden: File type not allowed');
      }
  
      // logger.info(`[download] ${userLogDisplay(req.user, req.ip)} -> ${fullPath} (${ext} | ${mimeType})`);

      // Set headers to force download
      //res.setHeader('Content-Disposition', `attachment; filename="${path.basename(fullPath)}"`); // force browser to download
      res.setHeader('Content-Disposition', 'inline'); // open in browser
      res.setHeader('Content-Type', mimeType);
      if (forceTypeAllowed) // it's an assets resource, cache it, otherwise no cache
        res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
      res.sendFile(fullPath);
      return
    }

    // otherwise, it's a directory, serv that up:
    logger.info(`[listing]  ${userLogDisplay(req.user, req.ip)} -> '${req_path}' -> '${fullPath}'`);
    const directoryContents = getDirectoryContents(relPath);
    if (directoryContents === null) {
      logger.warn(`[error]    ${userLogDisplay(req.user, req.ip)} -> 404 - Not Found: '${req_path}' -> ${fullPath}`);
      return res.status(404).send('404 - Not Found');
    }

    // HTML response, render page DOM:
    res.send(template.file( "page.template.html", {
      TITLE,
      ASSETS_MAGIC,
      BACKBUTTON_PATH: `${relPath == "" ? "" : req.baseUrl}/${relPath.split('/').slice(0, -1).join('/')}`,
      BACKBUTTON_VISIBILITY: `${relPath == '' ? "hidden" : "visible"}`,
      PAGE_TITLE: `/${relPath.replace( /\s/g, "&nbsp;" )}`,
      USER: `${req.user}`,
      SCROLL_CLASS: "scroll-child-browser",
      WHITESPACE: "nowrap",
      BODY: `
            <!-- <li>${relPath !== '' ? `<a href="${relPath.split('/').slice(0, -1).join('/') || '/'}">⬆️  Go Up</a>` : '<a href="">📁 /</a>'}</li> -->
            ${directoryContents.map(item => `
                <li>
                    ${item.isDirectory
                        ? `<a href="${req.baseUrl}/${encodeURIComponent( path.join( relPath, item.path ) )}">📁 ${item.name}</a>`
                        : `<a href="${req.baseUrl}/${encodeURIComponent( path.join( relPath, item.path ) )}">📄 ${item.name}</a> <a href="${req.baseUrl}/${encodeURIComponent( path.join( relPath, item.path ) )}" download target="_blank">⬇️&nbsp;&nbsp;</a>`}
                </li>
            `).join('')}
            &nbsp;<BR>
            &nbsp;<BR>
      `
    })
  );
  } catch (error) {
    logger.warn(`[error]    ${userLogDisplay(req.user, req.ip)} -> 404 Not Found: ${fullPath}, ${error}`);
    res.status(404).send('404 - Not Found');
  }
});


function init(l) {
  logger = l
  template.init( l );
  sanitizer.init( l, ALLOW_DOTFILES );
}

// Plug into Express
module.exports.router = router;
module.exports.init = init;


