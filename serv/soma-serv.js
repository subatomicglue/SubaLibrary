#!/usr/bin/env node
const express = require('express');
const path = require('path');
const fs = require('fs');
const mime = require('mime-types');
const rateLimit = require('express-rate-limit');
const winston = require('winston');
require('winston-daily-rotate-file');
const cookieParser = require('cookie-parser');
const SECRET_PASSCODE = require('./passcode.json') // txt file with single quoted string in it... e.g. "<your passcode here>"
const {
  TITLE,
  PORT_DEFAULT,
  PUBLIC_DIR: PUBLIC_DIR_CONFIG,
  LOGS_DIR: LOGS_DIR_CONFIG,
  ASSETS_DIR: ASSETS_DIR_CONFIG,
  ALLOWED_EXTENSIONS: ALLOWED_EXTENSIONS_ARRAY,
  RATE_LIMIT_WINDOW_SECS,
  RATE_LIMIT_WINDOW_MAX_REQUESTS
} = require('./soma-serv.json')

// validate/fixup config items
const PUBLIC_DIR=path.resolve(PUBLIC_DIR_CONFIG); // resolve ensures abs path, share location for served files
const LOGS_DIR=path.resolve(LOGS_DIR_CONFIG); // resolve ensures abs path, location for logs
const PORT = process.env.NODE_PORT ? process.env.NODE_PORT : PORT_DEFAULT; // override the default port with: $ NODE_PORT=3002 ./soma-serv.js
const ALLOWED_EXTENSIONS = new Set(ALLOWED_EXTENSIONS_ARRAY);
const ASSETS_DIR = path.resolve(ASSETS_DIR_CONFIG); // resolve ensures abs path, location for assets (fonts, logos, for soma-serv)
const ASSETS_MAGIC = "____aSsEtS____" // magic URL key for pulling assets (if URL request is not present here, it'll still fallback to public_dir next...)

// Limit each IP to 10 file requests per minute
const fileDownloadLimiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_SECS * 1000, // x seconds
  max: RATE_LIMIT_WINDOW_MAX_REQUESTS, // x requests per minute per IP
  message: 'Too many download requests. Please try again later.'
});

// Ensure logs directory exists
fs.mkdirSync(LOGS_DIR, { recursive: true });

// Configure Winston Logger with Size-Based Log Rotation
const transport = new winston.transports.DailyRotateFile({
    filename: path.join(LOGS_DIR, 'server-%DATE%.log'),
    datePattern: 'YYYY-MM-DD', // Keeps separate files but with size limit
    maxSize: '5m',  // Each log file max 5MB
    maxFiles: '10', // Keep a maximum of 10 log files (i.e., ~50MB total storage)
    zippedArchive: true, // Compress old logs to save space
});

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [transport, new winston.transports.Console()]
});

///////////////////////////////////////////////////////////////////////////////
// app
///////////////////////////////////////////////////////////////////////////////

const app = express();
app.disable('x-powered-by'); // be more stealthy
app.set('etag', false); // be more stealthy, plus, we want the latest sent when working on organizing the library...

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

// for use by sanitize() only...
function ___filterInvalidPaths( p ) {
  return path.normalize( p )
  .replace(/\0/g, '')                  // Remove any null bytes to prevent poison null byte attacks
  .replace( /^\//g, '' )               // no "/*"
  .replace( /\.\.?\.?\//g, '' )        // no ../ or .../ or ./
  .replace( /\/\.\.?\.?/g, '' )        // no /.. or /... or /.      (right, no dot files)
  .replace( /^\./g, '' )               // no ".*"
  .replace( /\/\.$/g, '' )             // no "*/."
  .replace( /^\.\./g, '' )             // no "..*"
  .replace( /\/\.\.$/g, '' )           // no "*/.."
  .replace( /^\.+$/g, '' )             // no ".." or ".." or "..."
  .replace( /^\/$/, '' )               // no "/"
}

// auto tests:
function test_filterInvalidPaths( p, expected_result ) {
  let pp = ___filterInvalidPaths( p );
  logger.info(`[auto test] : '${p}' -> '${pp}'`);
  if (expected_result != pp)
    throw `unexpected result in test_filterInvalidPaths ${p} != ${pp}`
}
test_filterInvalidPaths( "..", "" )
test_filterInvalidPaths( "../", "" )
test_filterInvalidPaths( "bok/..", "" )
test_filterInvalidPaths( "bok/../../", "" )
test_filterInvalidPaths( "/../../", "" )
test_filterInvalidPaths( "my/file/is/so/amazing/../../.../file..ext", "my/file/is/file..ext" )

// Function to sanitize and securely resolve paths.  Does NOT check if file exists
function sanitize( baseDir, rel_path ) {
  try {
    // Sanitize the path by removing any ".." segments, making sure it's relative under the base dir (no shenanigans from the requestor).
    const relPath = path.relative( baseDir, path.join(baseDir, ___filterInvalidPaths( rel_path ) ) );
    //logger.info(`[sanitize] : relPath: '${relPath}'`);
    const fullPath = path.join( baseDir, relPath );
    if (!fullPath.startsWith( baseDir )) {
      // something unsafe is happening, abort.
      logger.error(`[ERROR] : SHOULD NEVER HAPPEN: path goes outside of the public directory -> ${fullPath}`);
      return { relPath: "", fullPath: ""/*, realPath: undefined*/, mimeType: "application/octet-stream", ext: "?" }; // Return null if the path goes outside of the public directory
    }
    // if (!fs.existsSync( fullPath )) {
    //   // it's ok, but it's file not found
    //   return { relPath, fullPath, realPath: undefined };
    // }
    //const realPath = fs.realpathSync( fullPath );
    let mimeType = mime.lookup(fullPath) || 'application/octet-stream'
    let ext = path.extname(fullPath).substring(1).toLowerCase()
    return { relPath, fullPath/*, realPath*/, mimeType, ext };
  } catch (error) {
    logger.error(`[ERROR] : ${baseDir}, ${rel_path} ${error}`);
    return { relPath: "", fullPath: ""/*, realPath: undefined*/, mimeType: "application/octet-stream", ext: "?" }; // Return null if the path goes outside of the public directory
  }
}

function test_sanitize( p, expected_result ) {
  let pp = sanitize( PUBLIC_DIR, p ).relPath;
  logger.info(`[auto test] : '${p}' -> '${pp}'`);
  if (expected_result != pp)
    throw `unexpected result in test_sanitize ${p} != ${pp}`
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
      .filter(item => item.isDirectory || ALLOWED_EXTENSIONS.has(item.ext))  // Only show allowed files
      .sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1));  // Sort directories first
  } catch (error) {
    logger.warn(`[error] : Error reading '${rel_dir}' -> ${error}`);
    return null; // Return null if inaccessible or an error occurs
  }
}


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// endpoints
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// Middleware to parse cookies and URL-encoded form data
app.use(cookieParser());
app.use(express.urlencoded({ extended: true })); // Needed to parse form submissions
const loginAttempts = {}; // Store failed attempts per IP

// 🔒 Increasing timeout on repeated login fail attempts.
function failedLoginGuard(req, res, next) {
    const ip = req.ip; // Get user's IP address

    if (!loginAttempts[ip]) {
        loginAttempts[ip] = { count: 0, nextTry: Date.now() };
    }

    const attempt = loginAttempts[ip];

    // If user is locked out, check if the lockout time has expired
    if (Date.now() < attempt.nextTry) {
      const waitTime = Math.ceil((attempt.nextTry - Date.now()) / 1000);
      logger.info(`[login locked out]: ${req.ip} -> Too many failed attempts.  Try again in ${waitTime} seconds.`);
      return res.status(429).send(`Too many failed attempts. Try again in ${waitTime} seconds.  <a href="/">Try again</a>`);
    }

    next(); // Allow the login attempt
}

// 🔒 Authentication Middleware
function authGuard(req, res, next) {
    const userPasscode = req.cookies.passcode; // Get passcode from cookie

    if (userPasscode === SECRET_PASSCODE) {
        return next(); // Passcode matches - Proceed to the next middleware
    }

    logger.info(`[login]: ${req.ip} -> Please Enter Passcode for ${TITLE}`);

    // If passcode is incorrect/missing, show the login page
    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Authentication Required ${TITLE}</title>
        </head>
        <body>
            <h2>Enter Passcode</h2>
            <form method="POST" action="/login">
                <input type="password" name="passcode" required>
                <button type="submit">Submit</button>
            </form>
        </body>
        </html>
    `);
}

// 🔒 Login Route (Handles Form Submission)
app.post('/login', failedLoginGuard, (req, res) => {
  const ip = req.ip;
  const enteredPasscode = req.body.passcode;

  if (enteredPasscode === SECRET_PASSCODE) {
    logger.info(`[login authorized]: ${req.ip} -> Accepted Secret Passcode`);
    res.cookie('passcode', SECRET_PASSCODE, { httpOnly: true });
    delete loginAttempts[ip]; // Reset failure count on success
    return res.redirect('/');
  }

  // Track failed attempts and enforce increasing delay
  if (!loginAttempts[ip]) {
      loginAttempts[ip] = { count: 1, nextTry: Date.now() };
  } else {
      loginAttempts[ip].count++;
      loginAttempts[ip].nextTry = Date.now() + Math.min(60000, 5000 * loginAttempts[ip].count); // Increase timeout (max 60 sec)
  }

  logger.warn(`[login unauthorized]: ${req.ip} -> Incorrect passcode '${enteredPasscode}'`);
  res.status(403).send(`Incorrect passcode. Too many attempts will result in a lockout.  <a href="/">Try again</a>`);
});

// 🔒 Logout Route: Clears the cookie and redirects to login
app.get('/logout', (req, res) => {
  res.clearCookie('passcode'); // Remove the authentication cookie
  res.send('<h1>Logged out.</h1><a href="/">Go back</a>');
});

// 🔒 Apply authGuard middleware to all protected routes
app.use(authGuard);

// [browse] 1. Serve directory listing or 2. Serve Files, from under the PUBLIC_DIR (user input sanitized to ensure safety)
app.get('*', (req, res) => {
  const req_path = decodeURIComponent( req.path )

  // get sanitized version of what's asked for:
  const { relPath, fullPath, mimeType, ext } = sanitize( PUBLIC_DIR, req_path ); // ensure path is under PUBLIC_DIR, no shenanigans with "..", etc.
  logger.info(`[browse]: ${req.ip} -> '${req_path}' -> '${relPath}' -> '${fullPath}'`);
  if (fullPath == "") {
    logger.warn(`[error] ${req.ip} -> 403 - Forbidden: ${relPath}`);
    return res.status(403).send('403 - Forbidden');
  }

  try {
    // if we see a path starting with ASSETS_MAGIC, it may be an ASSET_DIR/ request, if file is present there, return it;  if not, pass through to next stages
    let asset_match_result = relPath.match( new RegExp( `${ASSETS_MAGIC}(.*)$` ) )
    let asset_info = (asset_match_result && asset_match_result[1]) ? sanitize( ASSETS_DIR, asset_match_result[1] ) : undefined
    if ((asset_match_result && asset_match_result[1]) && isFile( asset_info.fullPath )) {
      res.setHeader('Content-Disposition', 'inline'); // open in browser
      res.setHeader('Content-Type', asset_info.mimeType);
      res.sendFile(asset_info.fullPath);
      return
    }

    // Check if the requested path exists
    fs.accessSync(fullPath);

    // if the path points at a file, serv that up:
    if (isFile( fullPath )) {
      logger.info(`[requested]: ${req.ip} -> path:'${fullPath}' ext:'${ext}' mime:'${mimeType}'`);

      if (!ALLOWED_EXTENSIONS.has(ext)) {
          logger.warn(`[error] ${req.ip} -> 403 - Forbidden: File type not allowed: ${fullPath} (${ext})`);
          return res.status(403).send('403 - Forbidden: File type not allowed');
      }
  
      logger.info(`[download]: ${req.ip} -> ${fullPath} (${ext} | ${mimeType})`);
  
      // Set headers to force download
      //res.setHeader('Content-Disposition', `attachment; filename="${path.basename(fullPath)}"`); // force browser to download
      res.setHeader('Content-Disposition', 'inline'); // open in browser
      res.setHeader('Content-Type', mimeType);
      res.sendFile(fullPath);
      return
    }

    // otherwise, it's a directory, serv that up:
    logger.info(`[listing] : '${relPath}'`);
    const directoryContents = getDirectoryContents(relPath);
    if (directoryContents === null) {
      logger.warn(`[error] ${req.ip} -> 404 - Not Found: ${relPath}`);
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
                .heading-left-child-left-ellipsis {
                  white-space: nowrap;
                  overflow: hidden;
                  text-overflow: ellipsis;
                  display: block;
                  direction: rtl;
                  height: 100%;
                  line-height: 2em;
                }
                .heading-left-child-wrapword {
                  white-space: -moz-pre-wrap !important;  /* Mozilla, since 1999 */
                  white-space: -webkit-pre-wrap;          /* Chrome & Safari */ 
                  white-space: -pre-wrap;                 /* Opera 4-6 */
                  white-space: -o-pre-wrap;               /* Opera 7 */
                  white-space: pre-wrap;                  /* CSS3 */
                  word-wrap: break-word;                  /* Internet Explorer 5.5+ */
                  word-break: break-all;
                  white-space: normal;
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
                  <a href="/${relPath.split('/').slice(0, -1).join('/')}"><img style="margin-left: -5px; visibility:${relPath == '' ? "hidden" : "visible"}" src="${ASSETS_MAGIC}/arrow_back_ios_new_24dp_E3E3E3_FILL0_wght400_GRAD0_opsz24.svg"></a>
                </div><div class="heading-left">
                  <span dir="ltr" class="heading-left-child-left-ellipsis">&#x200E/${relPath.replace( /\s/g, "&nbsp;" )}</span>
                </div><div class="heading-right">
                  &nbsp;${TITLE}<BR><a style="color: grey;" href="/logout">&nbsp;logout</a>
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
    logger.warn(`[error] ${req.ip} -> 404 Not Found: ${fullPath}, ${error}`);
    res.status(404).send('404 - Not Found');
  }
});

// custom 404 for anything we forgot to cover in our routes.
app.use((req, res, next) => {
  res.status(404).send("Sorry can't find that!")
})

// custom 500 error handler - for anything that falls through, server's broken!
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).send('Something broke!')
})

// Start server
app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
