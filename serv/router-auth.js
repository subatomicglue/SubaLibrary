const cookieParser = require('cookie-parser');
const express = require("express");
const router = express.Router();
const template = require('./template');
const { getReferrerFromReq } = require( './common' )

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
  DOMAINS,
  BLACKLIST_CHECKS,
} = require('./settings');

let public_routes = []
const sec_to_ms = 1000;
const sec_to_wait = 30;
const wait_sec_max = 120;

const SCAN_ATTACK_PATHS = {
"/.env": true,
"/phpinfo": true,
"/_profiler/phpinfo": true,
"/info.php": true,
"/index.html": true,
"/backend/.env": true,
"/api/.env": true,
"/env.backup": true,
"/phpinfo.php": true,
"/main/.env": true,
"/.env.old": true,
"/api/config.env": true,
"/.aws/credentials": true,
"/lara/phpinfo.php": true,
"/core/.env": true,
"/application.properties": true,
"/prod/.env": true,
"/kyc/.env": true,
"/aws/credentials": true,
"/laravael/core/.env": true,
"/server-info.php": true,
"/.aws/config": true,
"/docker/app/.env": true,
"/lara/info.php": true,
"/.env.prod": true,
"/config/local.yml": true,
"/secrets/aws_ses.env": true,
"/awsstats/.env": true,
"/wp-config.php.bak": true,
"/admin/.env": true,
"/config/storage.yml": true,
"/settings.py": true,
"/apps/.env": true,
"/opt/aws/ses.env": true,
"/logs/aws/ses.log": true,
"/private/.env": true,
"/docker-compose.yml": true,
"/portal/.env": true,
"/env/.env": true,
"/app/.env": true,
"/dev/.env": true,
"/new/.env": true,
"/new/.env.local": true,
"/new/.env.production": true,
"/new/.env.staging": true,
"/_phpinfo.php": true,
"/_profiler/phpinfo/info.php": true,
"/_profiler/phpinfo/phpinfo.php": true,
"/wp-config": true,
"/aws-secret.yaml": true,
"/awstats/.env": true,
"/conf/.env": true,
"/cron/.env": true,
"/www/.env": true,
"/docker/.env": true,
"/xampp/phpinfo.php": true,
"/laravel/info.php": true,
"/.vscode/.env": true,
"/js/.env": true,
"/laravel/.env": true,
"/laravel/core/.env": true,
"/mail/.env": true,
"/mailer/.env": true,
"/nginx/.env": true,
"/public/.env": true,
"/site/.env": true,
"/xampp/.env": true,
"/node_modules/.env": true,
"/.env.bak": true,
"/api/shared/config/config.env": true,
"/api/shared/config.env": true,
"/config.env": true,
"/website/.env": true,
"/development/.env": true,
"/api/shared/config/.env": true,
"/api/shared/.env": true,
"/service/email_service.py": true,
"/node/.env_example": true,
"/.env.production.local": true,
"/.env.local": true,
"/.env.example": true,
"/.env.stage": true,
"/server/config/database.js": true,
"/.env_sample": true,
"/scripts/nodemailer.js": true,
"/crm/.env": true,
"/local/.env": true,
"/application/.env": true,
"/web/.env": true,
"/dashboard/phpinfo.php": true,
"/static/js/main.141b0494.js": true,
"/static/js/2.ca066a4b.chunk.js": true,
"/static/js/main.e85f7a37.js": true,
"/admin/server_info.php": true,
"/server_info.php": true,
"/app_dev.php/_profiler/phpinfo": true,
"/test.php": true,
"/server-info": true,
"/secured/phpinfo.php": true,
"/config.js": true,
"/server.js": true,
"/appsettings.json": true,
"/shared/config/config.js": true,
"/config/aws.yml": true,
"/config.json": true,
"/main.js": true,
"/config/constants.js": true,
"/public/js/main.js": true,
"/js/main.js": true,
};
const SCAN_ATTACK_IP_BLACKLIST = {};
function addToScannerBlackList( ip ) {
  SCAN_ATTACK_IP_BLACKLIST[ip] = true;
}
function isBlacklisted_Scanner( ip ) {
  return SCAN_ATTACK_IP_BLACKLIST[ip] == true;
}


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

function isWhitelisted(req) {
  const ua = req.get('User-Agent') || '';
  return ua.includes('facebookexternalhit') || ua.includes('Facebot');
}

function isBlacklisted(ip) {
  // Check if an IP matches any CIDR in the drop list
  return isBlacklisted_Scanner( ip ) || 
    (BLACKLIST_CHECKS ? false : require('ip-range-check')(ip, [...dropList])); // slow!
}

function logHelper(prefix, req) {
  let st = (obj) => JSON.stringify(obj, null, 2).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  logger.info( `[${prefix}]     - Headers:`, st( req.headers ));
  logger.info( `[${prefix}]     - Query params:`, st( req.query ));
  logger.info( `[${prefix}]     - Body:`, st( req.body ));
  logger.info( `[${prefix}]     - Route params:`, st( req.params ));
  logger.info( `[${prefix}]     - Original URL:`, st( req.originalUrl ) );
  logger.info( `[${prefix}]     - IP:`, st( req.ip ));
  logger.info( `[${prefix}]     - Cookies:`, st( req.cookies ));
}

// Middleware to parse cookies and URL-encoded form data
router.use(cookieParser());
router.use(express.urlencoded({ extended: true })); // Needed to parse form submissions
const loginAttempts = {}; // Store failed attempts per IP

// blacklist guard
router.use((req, res, next) => {
  //VERBOSE && logger.info( "USE blacklist guard ===================================================" )
  try {
    const ip = req.ip;
    if (!isWhitelisted(req) && isBlacklisted(ip)) {
      logger.info(`[blacklist guard] Blocked request from blacklisted IP: ${ip} isBlacklisted:${isBlacklisted(ip)}`);
      logHelper("blacklist guard", req);
      return res.send(template.file( "template.blacklisted-response.html", {} ))
    }
  } catch (error) {
    logger.info(`[blacklist guard] CRASH:  ${error}`);
    return res.send(`hello world`)
  }
  next();
});

// 🔒 Increasing timeout on repeated login fail attempts.
function failedLoginGuard(req, res, next) {
  //VERBOSE && logger.info( "failedLoginGuard ===================================================" )

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


function isObject(variable) {
  return variable !== null && typeof variable === 'object';
}


// 🔒 Authentication Middleware
function authGuard(req, res, next) {
  //VERBOSE && logger.info( "USE authGuard ===================================================" )

  try {
    if (req.cookies.passcode && req.cookies.passcode.length <= 4096) {
      const passcode = req.cookies.passcode; // Get passcode from cookie
      if (passcode === SECRET_PASSCODE) {
        req.user = ""
        //VERBOSE && logger.info( "USE authGuard passcode accepted" )
        return next(); // Passcode matches - Proceed to the next middleware
      }
    }

    if (req.cookies.userpass) {
      const userpass = req.cookies.userpass; // Get userpass from cookie
      const userpass_data = JSON.parse( req.cookies.userpass );
      const username = userpass_data && userpass_data.username; // Get username from cookie
      const password = userpass_data && userpass_data.password; // Get password from cookie
      if (username && password && username.length <= 256 && password.length <= 4096) {
        if (username in USERS_WHITELIST &&
          (
            (typeof USERS_WHITELIST[username] === 'string' && USERS_WHITELIST[username] == password) ||
            (typeof USERS_WHITELIST[username] === 'object' && USERS_WHITELIST[username].password == password)
          )
        ) {
          req.user = username;
          //VERBOSE && logger.info( `USE authGuard user/pass accepted user:${req.user}` )
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
      //VERBOSE && logger.info( "USE authGuard public route is ok" )
      return next(); // Passcode matches - Proceed to the next middleware
    }

    const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

    // block abusers
    if (loginAttempts[req.ip] && Date.now() < loginAttempts[req.ip].nextTry) {
      logHelper("auth guard", req);
    }

    // If passcode is incorrect/missing, show the login page
    if (req.path === "/login") {
      const referrer = getReferrerFromReq( req );
      logger.info(`[auth guard] ${req.ip} -> Please Enter Passcode for ${TITLE}.  Path: ${fullUrl}, Referrer:${referrer}`);
      return res.send(template.file( "template.login.html", {
        REFERRER: referrer,
        ENABLE_USERPASS: true,
        ENABLE_PASSCODE: SECRET_PASSCODE,
      }))
    }

    if (req.path == SCAN_ATTACK_PATHS) {
      logger.info(`[auth guard] 404 NOT FOUND ip:${req.ip} -> path:${req.path} (scanner attacker!)`);
      addToScannerBlackList( req.ip )
    } else {
      logger.info(`[auth guard] 404 NOT FOUND ip:${req.ip} -> path:${req.path} (not logged in)`);
    }
    return res.status(404).send("Not Found");
  } catch (error) {
    logger.info(`[auth guard] ${req.ip} -> path:${req.path}, CRASH: ${error}`);
    logger.info(error)
    return res.status(403).send(`no, go away`);
  }
}


router.get('/login', authGuard, (req, res, next) => {
  // if we get here, it's because we passed the authGuard, meaning, we got the cookie/user/pass to get in
  // So we're in!
  // so redirect to the referrer...
  let referrerPath = getReferrerFromReq( req )
  //VERBOSE && logger.info( `GET /login for user:${req.user} referrerPath:${referrerPath} ===================================================` )
  return req.user ? res.redirect(referrerPath) : next();
})


// 🔒 Login Route (Handles Form Submission)
router.post('/login', failedLoginGuard, (req, res) => {
  const ip = req.ip;
  const referrer = getReferrerFromReq( req );

  //VERBOSE && logger.info( `POST /login referrer:${referrer} ===================================================` )

  // passcode auth
  if (req.body.passcode && req.body.passcode.length <= 4096) {
    const passcode = req.body.passcode;
    //VERBOSE && logger.warn(`[login] debug: ${req.ip} passcode:'${passcode}'`);
    if (passcode === SECRET_PASSCODE) {
      logger.info(`[login] authorized: ${req.ip} -> Accepted Secret Passcode, referrer:${referrer}`);
      res.cookie('passcode', passcode, {
        httpOnly: true,         // Prevents JS access (secure against XSS)
        secure: true,           // Ensures cookie is sent only over HTTPS
        sameSite: 'lax',        // Prevents CSRF, while allowing normal usage (lax, strict, none)
        maxAge: 52 * 7 * 24 * 60 * 60 * 1000, // 52 weeks in milliseconds
      });
      delete loginAttempts[ip]; // Reset failure count on success
      return res.redirect(referrer);
    }
    logger.warn(`[login] unauthorized: ${req.ip} -> Incorrect passcode '${passcode}'`);
  }

  // user/pass auth
  if (req.body.username && req.body.password && req.body.username.length <= 32 && req.body.password.length <= 4096) {
    const username = req.body.username;
    const password = req.body.password;
    //VERBOSE && logger.warn(`[login] debug: ${req.ip} -> user/pass '${username in USERS_WHITELIST}' '${USERS_WHITELIST[username] == password}'`);
    if (username in USERS_WHITELIST &&
      (
        (typeof USERS_WHITELIST[username] === 'string' && USERS_WHITELIST[username] == password) ||
        (typeof USERS_WHITELIST[username] === 'object' && USERS_WHITELIST[username].password == password)
      )
    ) {
      logger.info(`[login] authorized: ${req.ip} -> Accepted User/Pass for '${username}', referrer:${referrer}`);
      res.cookie('userpass', JSON.stringify( { username, password } ), {
        httpOnly: true,         // Prevents JS access (secure against XSS)
        secure: true,           // Ensures cookie is sent only over HTTPS
        sameSite: 'lax',        // Prevents CSRF, while allowing normal usage (lax, strict, none)
        maxAge: 52 * 7 * 24 * 60 * 60 * 1000, // 52 weeks in milliseconds
      });
      delete loginAttempts[ip]; // Reset failure count on success
      return res.redirect(referrer);
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
  //VERBOSE && logger.info( "GET /logout ===================================================" )
  res.clearCookie('passcode'); // Remove the authentication cookie
  res.clearCookie('userpass'); // Remove the authentication cookie
  const referrer = getReferrerFromReq( req );

  return res.send(template.file( "template.logout.html", { REFERRER: referrer } ))
});

// 🔒 Apply authGuard middleware to all protected routes
router.use(authGuard);




//////////////////////////////////////////////////////////////////////////////


function init(l, publicroutes) {
  logger = l

  public_routes = [...publicroutes]

  // Call fetch on startup
  if (BLACKLIST_CHECKS) fetchDropList();
}

// Plug into Express
module.exports.router = router;
module.exports.init = init;


// guard certain routes
function guardForProdHostOnly(allowed_hostname) {
  //VERBOSE && logger.info( "guardOnlyAllowHost ===================================================" )
  return (req, res, next) => {
    // detect production / dev mode
    const currentDomain = `${req.get('host')}`;
    const prod_mode = DOMAINS.includes( currentDomain )
    if (!prod_mode) {
      return next()
    }
    const hostname = req.hostname.toLowerCase();
    if (hostname !== allowed_hostname && !hostname.startsWith(`${allowed_hostname}.`)) {
      logger.info( `[auth] guardOnlyAllowHost: host:${hostname} allowed:${allowed_hostname}` ); 
      return res.status(403).send(`Forbidden`);
    }

    next();
  }
}
module.exports.guardForProdHostOnly = guardForProdHostOnly;

// Middleware to redirect anonymous users to www.<domain> while preserving the path
function redirectAnonUsersToStaticSite(activeSiteHostname, staticSiteHostname = "www") {
  return (req, res, next) => {
    const currentDomain = req.get('host');
    const host = req.get('host').replace(/\..*$/, '');
    const prod_mode = DOMAINS.includes(currentDomain); // Check if the domain is in production

    const userIsAnonymous = req.user === USER_ANON_DISPLAY || req.user === "";

    // If in production mode, user is anonymous, and on the active site, and not static site, redirect to www.<domain> while retaining the path
    if (prod_mode && userIsAnonymous && (host === activeSiteHostname && activeSiteHostname != staticSiteHostname)) {
      const domainWithoutPrefix = currentDomain.split('.').slice(1).join('.');
      const redirectHost = `${staticSiteHostname}.${domainWithoutPrefix}`;
      const redirectUrl = `https://${redirectHost}${req.originalUrl}`; // Preserve the original path and query string

      logger.info(`[auth] REDIRECT anonymous user: ${req.hostname} -> ${redirectUrl}`);
      return res.redirect(redirectUrl);
    }

    next(); // Allow request if user is logged in or if not in production mode
  }
}
module.exports.redirectAnonUsersToStaticSite = redirectAnonUsersToStaticSite;
