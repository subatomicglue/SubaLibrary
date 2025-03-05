#!/usr/bin/env node
const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const pm2 = require('pm2');
const os = require('os');
const mime = require('mime-types');
const rateLimit = require('express-rate-limit');
const winston = require('winston');
require('winston-daily-rotate-file');
const cookieParser = require('cookie-parser');
const {
  TITLE,
  PORT_DEFAULT,
  PUBLIC_DIR: PUBLIC_DIR_CONFIG,
  LOGS_DIR: LOGS_DIR_CONFIG,
  ASSETS_DIR: ASSETS_DIR_CONFIG,
  ALLOWED_EXTENSIONS: ALLOWED_EXTENSIONS_ARRAY,
  RATE_LIMIT_WINDOW_SECS,
  RATE_LIMIT_WINDOW_MAX_REQUESTS,
  MAX_PATH_LENGTH: MAX_PATH_LENGTH_CONFIG,
  USE_HTTPS,
  HTTPS_CERT_CRT,
  HTTPS_CERT_CSR,
  HTTPS_CERT_KEY
} = require('./soma-serv.json')
let USERS_WHITELIST;
try {USERS_WHITELIST = require('./users.json')} catch(error) {console.log( "INFO: you may define users.json with { 'username': 'pass' } format" )}
let SECRET_PASSCODE;
try {SECRET_PASSCODE = require('./passcode.json')} catch(error) {console.log( "INFO: you may define passcode.json with \"<your passcode here>\" format" )}

// validate/fixup config items
const PUBLIC_DIR=path.resolve(PUBLIC_DIR_CONFIG); // resolve ensures abs path, share location for served files
const LOGS_DIR=path.resolve(LOGS_DIR_CONFIG); // resolve ensures abs path, location for logs
const PORT = process.env.NODE_PORT ? process.env.NODE_PORT : PORT_DEFAULT; // override the default port with: $ NODE_PORT=3002 ./soma-serv.js
const ALLOWED_EXTENSIONS = new Set(ALLOWED_EXTENSIONS_ARRAY);
const ASSETS_DIR = path.resolve(ASSETS_DIR_CONFIG); // resolve ensures abs path, location for assets (fonts, logos, for soma-serv)
const ASSETS_MAGIC = "____aSsEtS____" // magic URL key for pulling assets (if URL request is not present here, it'll still fallback to public_dir next...)
const isPM2 = process.env.pm_id !== undefined;
let pm2_currentProcess = undefined;
const MAX_PATH_LENGTH = MAX_PATH_LENGTH_CONFIG ? MAX_PATH_LENGTH_CONFIG : 4096; // 4KB max path length default
let current_user = "unknown"

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
        winston.format.errors({ stack: true }), // Ensures stack traces are logged
        winston.format.json()
    ),
    transports: [transport, new winston.transports.Console()],
    exceptionHandlers: [transport, new winston.transports.Console()],
    rejectionHandlers: [transport, new winston.transports.Console()]
});

// Track new connections
let activeConnections = {};
const activeConnectionsTimeout = 60 * 1000; // minute
const uptimeTimer = 60 * 60 * 1000; // hour
function numActiveConnections() {
  return Object.keys(activeConnections).map( r=>activeConnections[r] ).reduce((accumulator, currentValue) => accumulator + currentValue, 0);
}
function reportConnections() {
  logger.info( `🔌 [connections] total:${numActiveConnections()}` )
  Object.keys(activeConnections).forEach( r=> logger.info( `[🔌 connections] ip:'${r}' count:${activeConnections[r]}` ) )
}
function reportMemory() {
  const uptime = process.uptime();
  const memoryUsage = process.memoryUsage();
  logger.info(`⏳ [uptime] Uptime: ${uptime.toFixed(2)}s`);
  logger.info(`🧠 [memory] Memory Usage: ${JSON.stringify(memoryUsage)}`);
}
function reportPM2(options={}) {
  if (isPM2) {
    //logger.info(`🕒 [pm2] Running under PM2: ${isPM2}`);

    if (options.signal == "SIGINT") {
      logger.info(`🕒 [pm2] Restart Reason: ${options.signal} with PM2, implies Ctrl+C or PM2 stop`);
    }
    if (options.signal == "SIGTERM") {
      logger.info(`🕒 [pm2] Restart Reason: ${options.signal} with PM2, implies PM2 restart or system shutdown`);
    }
    if (options.signal == "SIGQUIT") {
      logger.info(`🕒 [pm2] Restart Reason: ${options.signal} with PM2, Rare, but sometimes used`);
    }

    if (pm2_currentProcess) {
      logger.info(`🕒 [pm2] Process Name: ${pm2_currentProcess.name}`);
      logger.info(`🕒 [pm2] Restarts: ${pm2_currentProcess.pm2_env.restart_time}`);
      logger.info(`🕒 [pm2] Restarts (Unstable): ${pm2_currentProcess.pm2_env.unstable_restarts}`);
      logger.info(`🕒 [pm2] Uptime: ${Date.now() - pm2_currentProcess.pm2_env.pm_uptime}ms`);
      logger.info(`🕒 [pm2] Status: ${pm2_currentProcess.pm2_env.status}`);
      logger.info(`🕒 [pm2] axm_options: ${JSON.stringify( pm2_currentProcess.pm2_env.axm_options )}`);
      //logger.info(`🕒 [pm2] pm2_env: ${JSON.stringify( pm2_currentProcess.pm2_env )}`);
      //logger.info(`🕒 [pm2] Restart Reason: ${(pm2_currentProcess.pm2_env.axm_options && pm2_currentProcess.pm2_env.axm_options.restart_reason) ? pm2_currentProcess.pm2_env.axm_options.restart_reason : 'Unknown'}`);
      logger.info(`🕒 [pm2] Exit Code: ${pm2_currentProcess.pm2_env.exit_code ? pm2_currentProcess.pm2_env.exit_code : 'Unknown'}`);
      logger.info(`🕒 [pm2] Triggered By: ${pm2_currentProcess.pm2_env.triggered_by ? pm2_currentProcess.pm2_env.triggered_by : 'Unknown'}`);
    }
  }
}
function reportOnExit(options={}) {
  logger.info(`🚪 ------------------------------------------------------------------------------------------`);
  logger.info(`🚪 [Exit Report]`);
  reportPM2(options)
  reportMemory()
  reportConnections()
  logger.info(`🚪 ==========================================================================================`);
}

// Capture Unhandled Errors
process.on('uncaughtException', (err) => {
  logger.error(`🔥 [on uncaughtException] Unhandled Exception: ${err.stack || err.message} connections:${numActiveConnections()}`);
  //reportOnExit();
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`⚠️ [on unhandledRejection] Unhandled Promise Rejection: ${reason}`);
  //reportOnExit();
  process.exit(1);
});

// Capture Process Signals (SIGTERM from PM2, etc.)
let onExitSignalHint
['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'].forEach((signal) => {
  process.on(signal, () => {
    logger.error(`🚦 [on ${signal}] Process exiting...`);
    onExitSignalHint = signal;
    //reportOnExit({signal});
    process.exit(0);
  });
});

process.on('exit', (code) => {
  logger.info(`👋 [on exit] Process exiting with code: ${code}`);
  reportOnExit(onExitSignalHint ? {signal: onExitSignalHint} : {});
  onExitSignalHint = undefined; // clear it...
});

if (isPM2) {
  pm2.connect(err => {
    logger.info(`🕒 [pm2] Connected to PM2...`);
    if (err) {
      console.error(err)
      process.exit(2)
    }

    // logger.info(`🕒 [pm2] PM2 detected process: registering exit handlers...`);
    pm2.launchBus((err, bus) => {
      if (err) return logger.error( err );

      bus.on('process:event', (data) => {
        logger.error(`🕒 [pm2] Process Event: ${data.process.name}: ${data.data}`);
        reportOnExit();
      });

      bus.on('process:exit', (data) => {
        logger.warn(`🕒 [pm2] PM2 detected process exit: ${data.process.name} (PID ${data.process.pm_id})`);
        reportOnExit();
      });

      bus.on('log:err', (data) => {
        logger.error(`🕒 [pm2] PM2 error log from ${data.process.name}: ${data.data}`);
        reportOnExit();
      });

      // Application Events
      bus.on('start', (proc) => logger.error(`🚀 [pm2] Process started: ${proc.process.name}`));
      bus.on('stop', (proc) => logger.error(`🛑 [pm2] Process stopped: ${proc.process.name}`));
      bus.on('restart', (proc) => logger.error(`🔄 [pm2] Process restarted: ${proc.process.name}`));
      bus.on('exit', (proc) => logger.error(`🚪 [pm2] Process exited: ${proc.process.name} (Code: ${proc.process.exit_code})`));
      bus.on('delete', (proc) => logger.error(`❌ [pm2] Process deleted: ${proc.process.name}`));
      bus.on('process:exit', (data) => logger.error(`🕒 [pm2] PM2 detected process exit: ${data.process.name} (PID ${data.process.pm_id})`));

      // // Log Events
      // bus.on('log:out', (data) => logger.error(`📜 [pm2] STDOUT: [${data.process.name}] ${data.data}`));
      bus.on('log:err', (data) => logger.error(`🔥 [pm2] STDERR: [${data.process.name}] ${data.data}`));

      // // Error & Exception Events
      bus.on('process:event', (data) => logger.error(`⚠️ [pm2] Process event: ${JSON.stringify(data)}`));
      bus.on('uncaughtException', (err) => logger.error(`💥 [pm2] Uncaught Exception: ${err}`));

      // // Special Restart Events
      bus.on('restart overlimit', (proc) => logger.error(`🚨 [pm2] Process restart over limit: ${proc.process.name}`));
      bus.on('exit:restart', (proc) => logger.error(`♻️ [pm2] Process exited and restarted: ${proc.process.name}`));

      // // PM2 System Events
      bus.on('pm2:kill', (data) => logger.error(`💀 [pm2] PM2 killed: ${data}`));
      bus.on('reload', (proc) => logger.error(`🔄 [pm2] PM2 reload triggered for: ${proc.process.name}`));
    });

    pm2.list((err, processList) => {
      if (err) {
        console.error('🕒 [pm2] Error retrieving PM2 process list:', err);
        return;
      }

      pm2_currentProcess = processList.find(p => p.pm_id == process.env.pm_id);
      reportPM2();
    });
  })
}

// Log Uptime & Memory Usage Periodically
setInterval(() => {
  reportMemory()
  reportConnections();
}, uptimeTimer); // Log every 30 seconds


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

// general guard, filter anything unexpected or unsupported by the app
app.use((req, res, next) => {
  if (req.params[0] && req.params[0].length > MAX_PATH_LENGTH) {
    return res.status(500).json({ error: "Path length exceeded the limit." });
  }

  if (Object.keys(req.query).length > 0) {
  //for (let key in req.query) {
  //  if (req.query[key] && req.query[key].length > MAX_PATH_LENGTH) {
      return res.status(500).json({ error: `Query parameter '${key}' is too long` });
  //  }
  }

  if (req.body && Object.keys(req.body).length > 0) {
  //for (let key in req.body) {
  //  if (req.body[key] && typeof req.body[key] === 'string' && req.body[key].length > MAX_PATH_LENGTH) {
      return res.status(500).json({ error: `Body parameter '${key}' is too long` });
  //  }
  }

  let acceptable_headers = { 'content-type': ["application/x-www-form-urlencoded"] }
  if (req.headers['content-type'] && !acceptable_headers['content-type'].includes( req.headers['content-type'] )) {
    logger.warn(`[content-type BLOCK] : Unexpected headers detected -> content-type:${req.headers['content-type']}`);
    return res.status(500).json({ error: `Unexpected headers detected. ${JSON.stringify( Object.keys( req.headers ) )} ${req.headers['content-type']}` });
  }

  next();
});

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
  if (req.cookies.passcode && req.cookies.passcode.length <= 4096) {
    const passcode = req.cookies.passcode; // Get passcode from cookie
    if (passcode === SECRET_PASSCODE) {
      current_user = ""
      return next(); // Passcode matches - Proceed to the next middleware
    }
  }

  if (req.cookies.userpass) {
    const userpass = req.cookies.userpass; // Get userpass from cookie
    const userpass_data = JSON.parse( req.cookies.userpass );
    const username = userpass_data && userpass_data.username; // Get username from cookie
    const password = userpass_data && userpass_data.password; // Get password from cookie
    if (username && password && username.length <= 256 && password.length <= 4096) {
      if (username in USERS_WHITELIST && USERS_WHITELIST[username] == password) {
        current_user = username;
        return next(); // Passcode matches - Proceed to the next middleware
      }
    }
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
              passcode: <input type="password" name="passcode" required>
              <button type="submit">Submit</button>
          </form>

          <form method="POST" action="/login">
              username: <input type="username" name="username" required>
              password: <input type="password" name="password" required>
              <button type="submit">Submit</button>
          </form>
      </body>
      </html>
  `);
}

// 🔒 Login Route (Handles Form Submission)
app.post('/login', failedLoginGuard, (req, res) => {
  const ip = req.ip;

  // passcode auth
  if (req.body.passcode) {
    const passcode = req.body.passcode;
    if (passcode === SECRET_PASSCODE) {
      logger.info(`[login authorized]: ${req.ip} -> Accepted Secret Passcode`);
      res.cookie('passcode', passcode, { httpOnly: true });
      delete loginAttempts[ip]; // Reset failure count on success
      return res.redirect('/');
    }
    logger.warn(`[login unauthorized]: ${req.ip} -> Incorrect passcode '${passcode}'`);
  }

  // user/pass auth
  if (req.body.username && req.body.password) {
    const username = req.body.username;
    const password = req.body.password;
    logger.warn(`[login testing...]: ${req.ip} -> Incorrect user/pass '${username in USERS_WHITELIST}' '${USERS_WHITELIST[username] == password}'`);
    if (username in USERS_WHITELIST && USERS_WHITELIST[username] == password) {
      logger.info(`[login authorized]: ${req.ip} -> Accepted User/Pass for '${username}'`);
      res.cookie('userpass', JSON.stringify( { username, password } ), { httpOnly: true });
      delete loginAttempts[ip]; // Reset failure count on success
      return res.redirect('/');
    }
    logger.warn(`[login unauthorized]: ${req.ip} -> Incorrect user/pass '${username}' '${password}'`);
  }

  // Track failed attempts and enforce increasing delay
  if (!loginAttempts[ip]) {
      loginAttempts[ip] = { count: 1, nextTry: Date.now() };
  } else {
      loginAttempts[ip].count++;
      loginAttempts[ip].nextTry = Date.now() + Math.min(60000, 5000 * loginAttempts[ip].count); // Increase timeout (max 60 sec)
  }

  res.status(403).send(`Incorrect passcode. Too many attempts will result in a lockout.  <a href="/">Try again</a>`);
});

// 🔒 Logout Route: Clears the cookie and redirects to login
app.get('/logout', (req, res) => {
  res.clearCookie('passcode'); // Remove the authentication cookie
  res.clearCookie('userpass'); // Remove the authentication cookie
  res.send('<h1>Logged out.</h1><a href="/">Go back</a>');
});

// 🔒 Apply authGuard middleware to all protected routes
app.use(authGuard);

// [browse] 1. Serve directory listing or 2. Serve Files, from under the PUBLIC_DIR (user input sanitized to ensure safety)
app.get('*', (req, res) => {
  const req_path = decodeURIComponent( req.path )
  const sanitized = sanitize( PUBLIC_DIR, req_path )
  let asset_match_result = undefined;

  // get sanitized version of what's asked for:
  // ensure path is under PUBLIC_DIR, no shenanigans with "..", etc.
  const { relPath, fullPath, mimeType, ext, forceTypeAllowed } = 
    sanitized.relPath.match( /^\/?favicon\.ico$/ ) ? sanitize( ASSETS_DIR, "favicon.ico", { forceTypeAllowed: true } ) :
    ((asset_match_result = sanitized.relPath.match( new RegExp( `${ASSETS_MAGIC}(.*)$` ) )) && asset_match_result[1]) ? sanitize( ASSETS_DIR, asset_match_result[1], { forceTypeAllowed: true } ) :
    sanitized;
  logger.info(`[browse]: ${req.ip} -> '${req_path}' -> '${relPath}' -> '${fullPath}'`);
  if (fullPath == "" || path.resolve(fullPath) != fullPath) {
    logger.warn(`[error] ${req.ip} -> 403 - Forbidden: ${relPath}`);
    return res.status(403).send('403 - Forbidden');
  }

  try {
    // Check if the requested path exists
    fs.accessSync(fullPath);

    // if the path points at a file, serv that up:
    if (isFile( fullPath )) {
      logger.info(`[requested]: ${req.ip} -> path:'${fullPath}' ext:'${ext}' mime:'${mimeType}'`);

      if (!ALLOWED_EXTENSIONS.has(ext) && !forceTypeAllowed) {
          logger.warn(`[error] ${req.ip} -> 403 - Forbidden: File type not allowed: ${fullPath} (${ext})`);
          return res.status(403).send('403 - Forbidden: File type not allowed');
      }
  
      logger.info(`[download]: ${req.ip} -> ${fullPath} (${ext} | ${mimeType})`);
  
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
                  <a href="/${relPath.split('/').slice(0, -1).join('/')}"><img style="margin-left: -5px; visibility:${relPath == '' ? "hidden" : "visible"}" src="${ASSETS_MAGIC}/arrow_back_ios_new_24dp_E3E3E3_FILL0_wght400_GRAD0_opsz24.svg"></a>
                </div><div class="heading-left">
                  <!--  Problem:  We use CSS "direction: rtl;" in order to get the left-hand elipsis effect when the path text overflows...
                        - Text like "my/path/to" is strongly LTR, so it doesn’t visually reverse when direction: rtl; is applied.
                        - The leading / character is a "weak" directional character, it follows the direction: rtl hint, flips to the other side.
                        - To force the leading / character to be "strongly LTR" also, use a "hidden" leading Unicode control character &#x200E
                  -->
                  <span dir="ltr" class="heading-left-child left-ellipsis">&#x200E/${relPath.replace( /\s/g, "&nbsp;" )}</span>
                </div><div class="heading-right">
                  &nbsp;${TITLE}<BR><a style="color: grey;" href="/logout">&nbsp;${current_user}&nbsp;logout</a>
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
const server = USE_HTTPS ?
  https.createServer({ key: fs.readFileSync(`${HTTPS_CERT_KEY}`), cert: fs.readFileSync(`${HTTPS_CERT_CRT}`)}, app) :
  http.createServer(app);

// track some connection stats
server.on('connection', (socket) => {
  //logger.info( `[connection open]: ${socket.remoteAddress}` )
  if (activeConnections[socket.remoteAddress] == undefined) activeConnections[socket.remoteAddress] = 0;
  activeConnections[socket.remoteAddress]++;
  socket.on('close', () => {
    //logger.info( `[connection close]: ${socket.remoteAddress}` )
    setTimeout( () => {
      activeConnections[socket.remoteAddress]--;
      if (activeConnections[socket.remoteAddress] == 0) delete activeConnections[socket.remoteAddress];
      //logger.info( `[connection count]: ${socket.remoteAddress} has ${activeConnections[socket.remoteAddress]} connections open` )
    }, activeConnectionsTimeout )
  });
});

server.listen(PORT, () => {
  logger.info(`🚀 ==========================================================================================`);
  logger.info(`🚀 Starting ${TITLE}...`)
  logger.info(`🚀 Server running at http${USE_HTTPS ? "s" : ""}://localhost:${PORT}`)
  reportPM2()
  reportMemory()
  logger.info(`🚀 ------------------------------------------------------------------------------------------`);
});
