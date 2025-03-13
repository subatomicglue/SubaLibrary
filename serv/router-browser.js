const path = require('path');
const fs = require('fs');
const os = require('os');
const mime = require('mime-types');
const express = require("express");
const router = express.Router();

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

// for use by sanitize() only...
function ___filterInvalidPaths( p ) {
  let result = path.normalize( p )
  .replace(/\0/g, '')                  // Remove any null bytes to prevent poison null byte attacks
  .replace( /\/\.+$/, '' )             // no trailing /. /.. /... etc.
  .replace( /^\//g, '' )               // no "/*"
  .replace( /\.\.?\.?\//g, '' )        // no ../ or .../ or ./
  .replace( /\/\.\.+/g, '/' )          // no /.. or /... or beyond  
  .replace( /\/\.$/g, '' )             // no "*/."
  .replace( /^\.\./g, '' )             // no "..*"
  .replace( /\/\.\.$/g, '' )           // no "*/.."
  .replace( /^\.+$/g, '' )             // no ".." or ".." or "..."
  .replace( /^\/$/, '' )               // no "/"

  if (ALLOW_DOTFILES != true)
    result = result.replace( /(^|\/)\.([^\/]+).*/, '' )       // (no dot files)
  return result;
}

// auto tests:
function test_filterInvalidPaths( p, expected_result ) {
  let pp = ___filterInvalidPaths( p );
  if (expected_result != pp) {
    logger.error(`[auto test] : '${p}' -> '${pp}' (expected ${expected_result})`);
    throw `unexpected result in test_filterInvalidPaths ${p} != ${pp}`
  }
}
test_filterInvalidPaths( ".", "" )
test_filterInvalidPaths( "..", "" )
test_filterInvalidPaths( "...", "" )
test_filterInvalidPaths( "../", "" )
test_filterInvalidPaths( "./", "" )
test_filterInvalidPaths( "../", "" )
test_filterInvalidPaths( ".../", "" )
test_filterInvalidPaths( "bok/.", "bok" )
test_filterInvalidPaths( "bok/..", "" )
test_filterInvalidPaths( "bok/...", "bok" )
test_filterInvalidPaths( "bok/.././", "" )
test_filterInvalidPaths( "bok/../../", "" )
test_filterInvalidPaths( "bok/../.../", "" )
test_filterInvalidPaths( "/.", "" )
test_filterInvalidPaths( "/..", "" )
test_filterInvalidPaths( "/...", "" )
test_filterInvalidPaths( "/../../", "" )
test_filterInvalidPaths( "my/file/is/so/amazing/../../.../file..ext", "my/file/is/file..ext" )
if (ALLOW_DOTFILES != true) {
  test_filterInvalidPaths( "bok/.dotdir/otherdir", "bok" )
  test_filterInvalidPaths( "bok/.dotfile", "bok" )
} else {
  test_filterInvalidPaths( "bok/.dotdir/otherdir", "bok/.dotdir/otherdir" )
  test_filterInvalidPaths( "bok/.dotfile", "bok/.dotfile" )
}

// Function to sanitize and securely resolve paths.  Does NOT check if file exists
function sanitize( baseDir, rel_path, options = {forceTypeAllowed: false} ) {
  try {
    // Sanitize the path by removing any ".." segments, making sure it's relative under the base dir (no shenanigans from the requestor).
    const relPath = path.relative( baseDir, path.join(baseDir, ___filterInvalidPaths( rel_path ) ) );
    //logger.info(`[sanitize] : relPath: '${relPath}'`);
    const fullPath = path.join( baseDir, relPath );
    if (!fullPath.startsWith( baseDir )) {
      // something unsafe is happening, abort.
      logger.error(`[ERROR] : SHOULD NEVER HAPPEN: path goes outside of the public directory -> ${fullPath}`);
      return { relPath: "", fullPath: ""/*, realPath: undefined*/, mimeType: "application/octet-stream", ext: "?", forceTypeAllowed: options.forceTypeAllowed == true }; // Return null if the path goes outside of the public directory
    }
    // if (!fs.existsSync( fullPath )) {
    //   // it's ok, but it's file not found
    //   return { relPath, fullPath, realPath: undefined };
    // }
    //const realPath = fs.realpathSync( fullPath );
    let mimeType = mime.lookup(fullPath) || 'application/octet-stream'
    let ext = path.extname(fullPath).substring(1).toLowerCase()
    return { relPath, fullPath/*, realPath*/, mimeType, ext, forceTypeAllowed: options.forceTypeAllowed == true };
  } catch (error) {
    logger.error(`[ERROR] : ${baseDir}, ${rel_path} ${error}`);
    return { relPath: "", fullPath: ""/*, realPath: undefined*/, mimeType: "application/octet-stream", ext: "?", forceTypeAllowed: options.forceTypeAllowed == true }; // Return null if the path goes outside of the public directory
  }
}

function test_sanitize( p, expected_result ) {
  let pp = sanitize( PUBLIC_DIR, p ).relPath;
  if (expected_result != pp) {
    logger.error(`[auto test] : '${p}' -> '${pp}'`);
    throw `unexpected result in test_sanitize ${p} != ${pp} (expected: ${expected_result})`
  }
}
test_sanitize( "", "" )
test_sanitize( "/", "" )
test_sanitize( "bok", "bok" )
test_sanitize( "bok/bok", "bok/bok" )
test_sanitize( "bok/../bok", "bok" )
test_sanitize( "bok/../../../bok", "bok" )
test_sanitize( "../../../../../etc", "etc" )
test_sanitize( "../../../../../etc/../../../..", "" )
test_sanitize( "../../../../../etc/../../../../", "" )
test_sanitize( "etc/../../../..", "" )
test_sanitize( "my/path/to/dotfile", "my/path/to/dotfile" )
if (ALLOW_DOTFILES != true) {
  test_sanitize( ".dotfile", "" )
  test_sanitize( ".dotdir/", "" )
  test_sanitize( "my/path/to/.dotfile", "my/path/to" )
  test_sanitize( "my/path/to/.dotdir/otherdir", "my/path/to" )
} else {
  test_sanitize( ".dotfile", ".dotfile" )
  test_sanitize( ".dotdir/", ".dotdir" )
  test_sanitize( "my/path/to/.dotfile", "my/path/to/.dotfile" )
  test_sanitize( "my/path/to/.dotdir/otherdir", "my/path/to/.dotdir/otherdir" )
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
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${TITLE}</title>
            <style>
                body { font-family: Arial, sans-serif; }
                ul { list-style-type: none; padding: 0; }
                li { margin: 5px 0; display: block; white-space: nowrap; padding-left: 1em; padding-right: 1em;}
                a { text-decoration: none; color: blue; }
                .scroll-parent {
                  overflow: hidden;
                }
                .scroll-child {
                  height: 100%;
                  overflow: scroll;
                }
                table, td {
                  padding:0;
                  margin:0;
                  vertical-align: top;
                }
                .heading-container {
                  display: flex;
                  padding: 1em;
                }
                .heading-backbutton {
                  text-align: center;
                  white-space: nowrap;
                }
                .heading-left {
                  flex: 1;
                  min-width: 0;
                  text-align: left;
                }
                .left-ellipsis {
                  white-space: nowrap;
                  overflow: hidden;
                  text-overflow: ellipsis;
                  display: block;
                  direction: rtl;
                }
                .wrapword {
                  white-space: -moz-pre-wrap !important;  /* Mozilla, since 1999 */
                  white-space: -webkit-pre-wrap;          /* Chrome & Safari */ 
                  white-space: -pre-wrap;                 /* Opera 4-6 */
                  white-space: -o-pre-wrap;               /* Opera 7 */
                  white-space: pre-wrap;                  /* CSS3 */
                  word-wrap: break-word;                  /* Internet Explorer 5.5+ */
                  word-break: break-all;
                  white-space: normal;
                }
                .heading-left-child {
                  height: 100%;
                  line-height: 2em;
                }
                .heading-right {
                  text-align: right;
                  white-space: nowrap;
                }
                .heading-left, .heading-backbutton, .heading-right {
                  flex-direction:column;
                  justify-content:space-around;
                  display:flex;
                }
          </style>
        </head>
        <body style="padding: 0; margin: 0;" >
          <div id="page" style="max-width: 100%; width: 100%; height: 100vh; height: 100dvh; display: flex; flex-direction: column; padding: 0; margin: 0;">
            <div id="page-title" style="max-width: 100%; width:100%; background:#333; color: #fff; margin: 0;">
              <div class="heading-container" style="">
                <div class="heading-backbutton">
                  <a href="/${relPath.split('/').slice(0, -1).join('/')}"><img style="margin-left: -5px; visibility:${relPath == '' ? "hidden" : "visible"}" src="${ASSETS_MAGIC}/arrow_back_ios_new_24dp_E3E3E3_FILL0_wght400_GRAD0_opsz24.svg">&nbsp;&nbsp;</a>
                </div><div class="heading-left">
                  <!--  Problem:  We use CSS "direction: rtl;" in order to get the left-hand elipsis effect when the path text overflows...
                        - Text like "my/path/to" is strongly LTR, so it doesn’t visually reverse when direction: rtl; is applied.
                        - The leading / character is a "weak" directional character, it follows the direction: rtl hint, flips to the other side.
                        - To force the leading / character to be "strongly LTR" also, use a "hidden" leading Unicode control character &#x200E
                  -->
                  <span dir="ltr" class="heading-left-child left-ellipsis">&#x200E/${relPath.replace( /\s/g, "&nbsp;" )}</span>
                </div><div class="heading-right">
                  &nbsp;${TITLE}<BR><a style="color: grey;" href="/logout">&nbsp;${req.user}&nbsp;logout</a>
                </div>
              </div>
            </div>
            <div id="page-body" class="scroll-parent" style="flex-grow: 1; padding: 0; margin: 0">
              <ul class="scroll-child" style="padding-top: 0; margin-top: 0.5em">
                  <!-- <li>${relPath !== '' ? `<a href="${relPath.split('/').slice(0, -1).join('/') || '/'}">⬆️  Go Up</a>` : '<a href="">📁 /</a>'}</li> -->
                  ${directoryContents.map(item => `
                      <li>
                          ${item.isDirectory
                              ? `<a href="/${encodeURIComponent( path.join( relPath, item.path ) )}">📁 ${item.name}</a>`
                              : `<a href="/${encodeURIComponent( path.join( relPath, item.path ) )}">📄 ${item.name}</a> <a href="/${encodeURIComponent( path.join( relPath, item.path ) )}" download target="_blank">⬇️&nbsp;&nbsp;</a>`}
                      </li>
                  `).join('')}
                  &nbsp;<BR>
                  &nbsp;<BR>
              </ul>
            </div>
          </div>
        </body>
        </html>
    `);
  } catch (error) {
    logger.warn(`[error]    ${userLogDisplay(req.user, req.ip)} -> 404 Not Found: ${fullPath}, ${error}`);
    res.status(404).send('404 - Not Found');
  }
});


function init(l) {
  logger = l
}

// Plug into Express
module.exports.router = router;
module.exports.init = init;


