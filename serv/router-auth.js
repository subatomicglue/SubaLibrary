const cookieParser = require('cookie-parser');
const express = require("express");
const router = express.Router();

const {
  TITLE,
  PUBLIC_DIR,
  LOGS_DIR,
  ASSETS_DIR,
  ALLOWED_EXTENSIONS,
  RATE_LIMIT_WINDOW_SECS,
  RATE_LIMIT_WINDOW_MAX_REQUESTS,
  MAX_PATH_LENGTH,
  USE_HTTPS,
  ALLOW_DOTFILES,
  VERBOSE,
  USERS_WHITELIST,
  SECRET_PASSCODE,
  ASSETS_MAGIC,
  isPM2,
  USER_ANON_DISPLAY,
} = require('./settings');

let public_routes = []
const sec_to_ms = 1000;
const sec_to_wait = 30;
const wait_sec_max = 120;


const https = require('https');
const SPAMHAUS_DROP_URL = 'https://www.spamhaus.org/drop/drop.txt';
let dropList = new Set();

const SOURCES = [
  {
    name: 'Spamhaus DROP',
    url: 'https://www.spamhaus.org/drop/drop.txt',
    filter: line => line && !line.startsWith(';'),
    parse: line => line.split(';')[0].trim(),
  },
  {
    name: 'Spamhaus EDROP',
    url: 'https://www.spamhaus.org/drop/edrop.txt',
    filter: line => line && !line.startsWith(';'),
    parse: line => line.split(';')[0].trim(),
  },
  {
    name: 'FireHOL Level 1',
    url: 'https://raw.githubusercontent.com/firehol/blocklist-ipsets/master/firehol_level1.netset',
    filter: line => line && !line.startsWith('#'),
    parse: line => line.trim(),
  },
  {
    name: 'Blocklist.de All',
    url: 'https://lists.blocklist.de/lists/all.txt',
    filter: line => line && !line.startsWith('#'),
    parse: line => line.trim(),
  },
  {
    name: 'CINS Active Threat List',
    url: 'https://cinsscore.com/list/ci-badguys.txt',
    filter: line => line && !line.startsWith('#'),
    parse: line => line.trim(),
  }
];

function fetchList({ name, url, filter, parse }) {
  return new Promise((resolve) => {
    https.get(url, res => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        const lines = raw.split('\n').filter(filter);
        const entries = lines.map(parse).filter(Boolean);
        logger.info(`[Blacklist] Fetched ${entries.length} entries from ${name}`);
        resolve(entries);
      });
    }).on('error', err => {
      logger.error(`[Blacklist] Failed to fetch ${name}: ${err.message}`);
      resolve([]);
    });
  });
}

async function fetchDropList() {
  logger.info('[Blacklist] Fetching IP blocklists...');
  dropList = new Set(); // Clear current set

  const results = await Promise.all(SOURCES.map(fetchList));

  results.flat().forEach(ip => dropList.add(ip));

  logger.info(`[Blacklist] Combined blocklist has ${dropList.size} total unique entries.`);
}

// Check if an IP matches any CIDR in the drop list
const ipRangeCheck = require('ip-range-check');

function isWhitelisted(req) {
  const ua = req.get('User-Agent') || '';
  return ua.includes('facebookexternalhit') || ua.includes('Facebot');
}

function isBlacklisted(ip) {
  return ipRangeCheck(ip, [...dropList]);
}


function logHelper(prefix, req) {
  let st = (obj) => JSON.stringify(obj, null, 2).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  console.log( `[${prefix}]     - Headers:`, st( req.headers ));
  console.log( `[${prefix}]     - Query params:`, st( req.query ));
  console.log( `[${prefix}]     - Body:`, st( req.body ));
  console.log( `[${prefix}]     - Route params:`, st( req.params ));
  console.log( `[${prefix}]     - Original URL:`, st( req.originalUrl ) );
  console.log( `[${prefix}]     - IP:`, st( req.ip ));
  console.log( `[${prefix}]     - Cookies:`, st( req.cookies ));
}


// Middleware to parse cookies and URL-encoded form data
router.use(cookieParser());
router.use(express.urlencoded({ extended: true })); // Needed to parse form submissions
const loginAttempts = {}; // Store failed attempts per IP


// blacklist guard
router.use((req, res, next) => {
  const ip = req.ip;
  if (!isWhitelisted(req) && isBlacklisted(ip)) {
    logger.info(`Blocked request from blacklisted IP: ${ip}`);
    logHelper("blacklist", req);
    return res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head></head>
      <body>This is just a test!  Hello World!</body>
      </html>
    `);
  }
  next();
});

// 🔒 Increasing timeout on repeated login fail attempts.
function failedLoginGuard(req, res, next) {
    const ip = req.ip; // Get user's IP address

    if (!loginAttempts[ip]) {
        loginAttempts[ip] = { count: 0, nextTry: Date.now() }; // weak, now, because we dont know if their user/pass was wrong or not...
    }

    const attempt = loginAttempts[ip];

    // If user is locked out, check if the lockout time has expired
    let waitTime = Math.ceil((attempt.nextTry - Date.now()) / sec_to_ms);
    //console.log( `[failedLoginGuard] now:${Date.now()} < nextTry:${attempt.nextTry} waittime:${waitTime}` )
    if (Date.now() < attempt.nextTry) {
      loginAttempts[ip].count++;
      loginAttempts[ip].nextTry = Date.now() + Math.min(wait_sec_max * sec_to_ms, sec_to_wait * sec_to_ms * loginAttempts[ip].count); // Increase timeout (max 60 sec)
      // logger.info(`[failedLoginGuard] locked out: ${req.ip} -> Too many failed attempts ${loginAttempts[ip].count}.  Try again in ${waitTime} seconds.`);
      return res.status(429).send(`Too many failed attempts. Try again in ${waitTime} seconds.  <a href="/">Try again</a>`);
    }
    //else {
    //   logger.info(`[failedLoginGuard] ok to log in ip:${req.ip} -> count:${loginAttempts[ip].count}.  Try again in ${waitTime} seconds.`);
    // }

    next(); // Allow the login attempt
}

// 🔒 Authentication Middleware
function authGuard(req, res, next) {
  try {
    if (req.cookies.passcode && req.cookies.passcode.length <= 4096) {
      const passcode = req.cookies.passcode; // Get passcode from cookie
      if (passcode === SECRET_PASSCODE) {
        req.user = ""
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
          req.user = username;
          return next(); // Passcode matches - Proceed to the next middleware
        }
      }
    }

    // is it public?  allow it immediately, no password needed.
    const req_path = decodeURIComponent( req.path )
    const is_public = public_routes.filter( r => req_path.match( new RegExp( r ) ) != undefined ).length > 0;
    if (is_public) {
      // console.log( "[authGuard] allowing PUBLIC viewonly: ", req_path )
      req.user = USER_ANON_DISPLAY
      return next(); // Passcode matches - Proceed to the next middleware
    }

    const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

    logger.info(`[auth guard] ${req.ip} -> Please Enter Passcode for ${TITLE}.  Path: ${fullUrl}`);

    // block abusers
    if (loginAttempts[req.ip] && Date.now() < loginAttempts[req.ip].nextTry) {
      logHelper("auth guard", req);
    }

    // If passcode is incorrect/missing, show the login page
    return res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Authentication Required</title>
        </head>
        <body>
            <h2>Enter User/Pass</h2>
            <form method="POST" action="/login">
                username: <input type="username" name="username" required>
                password: <input type="password" name="password" required>
                <button type="submit">Submit</button>
            </form>

            <h2>Enter Passcode</h2>
            <form method="POST" action="/login">
                passcode: <input type="password" name="passcode" required>
                <button type="submit">Submit</button>
            </form>
        </body>
        </html>
    `);
  } catch (error) {
    logger.info(`[auth guard] ${req.ip} -> req.path:${req.path}, CRASH: ${error}`);
    return res.status(403).send(`no, go away`);
  }
}

// 🔒 Login Route (Handles Form Submission)
router.post('/login', failedLoginGuard, (req, res) => {
  const ip = req.ip;

  // passcode auth
  if (req.body.passcode && req.body.passcode.length <= 4096) {
    const passcode = req.body.passcode;
    //VERBOSE && logger.warn(`[login] debug: ${req.ip} passcode:'${passcode}'`);
    if (passcode === SECRET_PASSCODE) {
      logger.info(`[login] authorized: ${req.ip} -> Accepted Secret Passcode`);
      res.cookie('passcode', passcode, {
        httpOnly: true,         // Prevents JS access (secure against XSS)
        secure: true,           // Ensures cookie is sent only over HTTPS
        sameSite: 'lax',        // Prevents CSRF, while allowing normal usage (lax, strict, none)
        maxAge: 52 * 7 * 24 * 60 * 60 * 1000, // 52 weeks in milliseconds
      });
      delete loginAttempts[ip]; // Reset failure count on success
      return res.redirect('/');
    }
    logger.warn(`[login] unauthorized: ${req.ip} -> Incorrect passcode '${passcode}'`);
  }

  // user/pass auth
  if (req.body.username && req.body.password && req.body.username.length <= 32 && req.body.password.length <= 4096) {
    const username = req.body.username;
    const password = req.body.password;
    //VERBOSE && logger.warn(`[login] debug: ${req.ip} -> user/pass '${username in USERS_WHITELIST}' '${USERS_WHITELIST[username] == password}'`);
    if (username in USERS_WHITELIST && USERS_WHITELIST[username] == password) {
      logger.info(`[login] authorized: ${req.ip} -> Accepted User/Pass for '${username}'`);
      res.cookie('userpass', JSON.stringify( { username, password } ), {
        httpOnly: true,         // Prevents JS access (secure against XSS)
        secure: true,           // Ensures cookie is sent only over HTTPS
        sameSite: 'lax',        // Prevents CSRF, while allowing normal usage (lax, strict, none)
        maxAge: 52 * 7 * 24 * 60 * 60 * 1000, // 52 weeks in milliseconds
      });
      delete loginAttempts[ip]; // Reset failure count on success
      return res.redirect('/');
    }
    logger.warn(`[login] unauthorized: ${req.ip} -> Incorrect user/pass '${username}' '${password}'`);
  }

  // Track failed attempts and enforce increasing delay
  if (!loginAttempts[ip]) {
    logger.warn( `[login] ip:${ip} count:1`)
    loginAttempts[ip] = { count: 1, nextTry: Date.now() + sec_to_wait * sec_to_ms };
  } else {
      loginAttempts[ip].count++;
      logger.warn( `[login] ip:${ip} count:${loginAttempts[ip].count}`)
      loginAttempts[ip].nextTry = Date.now() + Math.min(wait_sec_max * sec_to_ms, sec_to_wait * sec_to_ms * loginAttempts[ip].count); // Increase timeout (max 60 sec)
  }

  res.status(403).send(`[login] Incorrect passcode. Too many attempts will result in a lockout.  <a href="/">Try again</a>`);
});

// 🔒 Logout Route: Clears the cookie and redirects to login
router.get('/logout', (req, res) => {
  res.clearCookie('passcode'); // Remove the authentication cookie
  res.clearCookie('userpass'); // Remove the authentication cookie
  res.send('<h1>Logged out.</h1><a href="/">Go back</a>');
});

// 🔒 Apply authGuard middleware to all protected routes
router.use(authGuard);




//////////////////////////////////////////////////////////////////////////////


function init(l, publicroutes) {
  logger = l

  public_routes = [...publicroutes]

  // Call fetch on startup
  fetchDropList();
}

// Plug into Express
module.exports.router = router;
module.exports.init = init;

function guardOnlyAllowHost(allowed_hostname) {
  return (req, res, next) => {
    const hostname = req.hostname.toLowerCase();
    if (hostname !== allowed_hostname && !hostname.startsWith(`${allowed_hostname}.`)) {
      logger.info( `[auth] guardOnlyAllowHost: host:${hostname} allowed:${allowed_hostname}  ` ); 
      return res.status(403).send(`Forbidden`);
    }

    next();
  }
}
module.exports.guardOnlyAllowHost = guardOnlyAllowHost;
