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
const {TITLE, PORT_DEFAULT, PUBLIC_DIR, LOGS_DIR, ALLOWED_EXTENSIONS: ALLOWED_EXTENSIONS_ARRAY, RATE_LIMIT_WINDOW_SECS, RATE_LIMIT_WINDOW_MAX_REQUESTS} = require('./soma-serv.json')

const PORT = process.env.NODE_PORT ? process.env.NODE_PORT : PORT_DEFAULT; // default
const ALLOWED_EXTENSIONS = new Set(ALLOWED_EXTENSIONS_ARRAY);

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
    // Check if the file exists
    fs.accessSync(fullPath);

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
                li { margin: 5px 0; display: block; padding-right: 135px;white-space: nowrap;}
                a { text-decoration: none; color: blue; }
                .scroll-container {
                    white-space: nowrap;  /* Prevents text wrapping */
                    overflow-x: auto;     /* Enables horizontal scrolling */
                    overflow-y: hidden;   /* Hides vertical scrolling */
                    width: 100%;          /* Full width of the container */
                    max-width: 100%;      /* Ensures no overflow beyond parent */
                    display: block;       /* Ensures proper layout */
                    width: 100%;
                }

                .scroll-container::-webkit-scrollbar {
                    height: 8px; /* Adjust scrollbar thickness */
                }

                .scroll-container::-webkit-scrollbar-thumb {
                    background-color: #888; /* Color of the scrollbar */
                    border-radius: 4px;
                }

                .scroll-container::-webkit-scrollbar-track {
                    background: #f1f1f1; /* Background of the scrollbar track */
                }
            </style>
        </head>
        <body>
            <h2>Browsing: /${relPath}</h2>
            <ul class="scroll-container">
                ${req_path !== '/' ? `<li><a href="${req_path.split('/').slice(0, -1).join('/') || '/'}">⬆️  Go Up</a></li>` : '<a href="">📁 /</a>'}
                ${directoryContents.map(item => `
                    <li>
                        ${item.isDirectory 
                            ? `<a href="/${encodeURIComponent( path.join( relPath, item.path ) )}">📁 ${item.name}</a>`
                            : `<a href="/${encodeURIComponent( path.join( relPath, item.path ) )}">📄 ${item.name}</a> <a href="/${encodeURIComponent( path.join( relPath, item.path ) )}" download target="_blank">⬇️&nbsp;&nbsp;</a>`}
                    </li>
                `).join('')}
            </ul>
            <a href="/logout">logout</a>
        </body>
        </html>
    `);
  } catch (error) {
    logger.warn(`[error] ${req.ip} -> 404 Not Found: ${fullPath}`);
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
