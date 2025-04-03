const cookieParser = require('cookie-parser');
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

const public_routes = [ "^/wiki/view", "^/wiki" ]
const sec_to_ms = 1000;
const sec_to_wait = 30;
const wait_sec_max = 120;

// Middleware to parse cookies and URL-encoded form data
router.use(cookieParser());
router.use(express.urlencoded({ extended: true })); // Needed to parse form submissions
const loginAttempts = {}; // Store failed attempts per IP

// 🔒 Increasing timeout on repeated login fail attempts.
function failedLoginGuard(req, res, next) {
    const ip = req.ip; // Get user's IP address

    if (!loginAttempts[ip]) {
        loginAttempts[ip] = { count: 0, nextTry: Date.now() }; // weak, now, because we dont know if their user/pass was wrong or not...
    }

    const attempt = loginAttempts[ip];

    // If user is locked out, check if the lockout time has expired
    let waitTime = Math.ceil((attempt.nextTry - Date.now()) / sec_to_ms);
    console.log( `[failedLoginGuard] now:${Date.now()} < nextTry:${attempt.nextTry} waittime:${waitTime}` )
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

  // is it public?
  const req_path = decodeURIComponent( req.path )
  const is_public = public_routes.filter( r => req_path.match( new RegExp( r ) ) != undefined ).length > 0;
  if (is_public) {
    console.log( "[authGuard] serving public path: ", req_path )
    return next(); // Passcode matches - Proceed to the next middleware
  }

  logger.info(`[auth guard] ${req.ip} -> Please Enter Passcode for ${TITLE}`);

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
router.post('/login', failedLoginGuard, (req, res) => {
  const ip = req.ip;

  // passcode auth
  if (req.body.passcode && req.body.passcode.length <= 4096) {
    const passcode = req.body.passcode;
    VERBOSE && logger.warn(`[login] debug: ${req.ip} passcode:'${passcode}'`);
    if (passcode === SECRET_PASSCODE) {
      logger.info(`[login] authorized: ${req.ip} -> Accepted Secret Passcode`);
      res.cookie('passcode', passcode, { httpOnly: true });
      delete loginAttempts[ip]; // Reset failure count on success
      return res.redirect('/');
    }
    logger.warn(`[login] unauthorized: ${req.ip} -> Incorrect passcode '${passcode}'`);
  }

  // user/pass auth
  if (req.body.username && req.body.password && req.body.username.length <= 32 && req.body.password.length <= 4096) {
    const username = req.body.username;
    const password = req.body.password;
    VERBOSE && logger.warn(`[login] debug: ${req.ip} -> user/pass '${username in USERS_WHITELIST}' '${USERS_WHITELIST[username] == password}'`);
    if (username in USERS_WHITELIST && USERS_WHITELIST[username] == password) {
      logger.info(`[login] authorized: ${req.ip} -> Accepted User/Pass for '${username}'`);
      res.cookie('userpass', JSON.stringify( { username, password } ), { httpOnly: true });
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


function init(l) {
  logger = l
}

// Plug into Express
module.exports.router = router;
module.exports.init = init;

