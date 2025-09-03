const fs = require('fs');

// call it like:
// userLogDisplay( req )
// or
// userLogDisplay( username_str, ipaddr_str )
function userLogDisplay(req_object_or_user_str, req_ip_str) {
  let req_user = req_object_or_user_str == undefined ? "system" : typeof req_object_or_user_str == "object" ? req_object_or_user_str.user : req_object_or_user_str
  let req_ip = req_object_or_user_str == undefined ? "127.0.0.1" : typeof req_object_or_user_str == "object" ? req_object_or_user_str.ip : req_ip_str

  if (req_user == undefined) {
    console.log( "[common.userLogDisplay(req)] CONFIGURATION ERROR:  your router middleware probably needs to be moved to after the auth middleware....")
  }

  return `[${req_user!=""?`${req_user}@`:""}${req_ip.replace(/^::ffff:/, '')}]`
}
module.exports.userLogDisplay = userLogDisplay;



function getReferrerFromReq( req ) {
  const defaultReferrer = '/'
  let referrerPath = defaultReferrer;

  const protocol = req.protocol; // 'http' or 'https'
  const host = req.get('host'); // e.g., 'localhost:3000' or 'example.com'
  const baseUrl = `${protocol}://${host}`; // Full base URL

  const VERBOSE = false;
  // VERBOSE && console.log( "getReferrerFromReq | body: ", req.body && req.body.referrer )
  // VERBOSE && console.log( "getReferrerFromReq | query: ", req.query.referrer )
  // VERBOSE && console.log( "getReferrerFromReq | headers: ", req.get('Referer') || req.headers['referer'] || req.headers['referrer'] )

  // from body (POST) (highest priority, if directly submitted by a form, it'll be on the body)
  if (referrerPath == defaultReferrer && req.body && req.body.referrer ) {
    referrerPath = req.body.referrer
    VERBOSE && console.log( `getReferrerFromReq from body (POST) referrerPath:${referrerPath}`)
  }

  // from query params (next highest priority, if in the URL query params, we definitely want to respond to this)
  if (referrerPath == '/' && req.query.referrer ) {
    referrerPath = decodeURIComponent( req.query.referrer )
    VERBOSE && console.log( `getReferrerFromReq from query params referrerPath:${referrerPath}`)
  }

  // from headers (GET)  (see if any headers have a better referrer than '/')
  if (referrerPath == '/') {
    referrerPath = req.get('Referer') || req.headers['referer'] || req.headers['referrer'] || referrerPath;
  }

  // split the https://<domain> off the path...
  try {
    const url = new URL(referrerPath, baseUrl);
    referrerPath = url.pathname
    VERBOSE && console.log( `getReferrerFromReq path:${referrerPath}`)
  } catch (error) {
    logger.error(`[getReferrerFromReq] Invalid referrer URL in headers: ${referrerPath}`);
  }

  VERBOSE && console.log( `getReferrerFromReq == ${referrerPath}`)
  return referrerPath || defaultReferrer
}
module.exports.getReferrerFromReq = getReferrerFromReq;


let cached_files = {} // key is the filename
function fs_readFileSync_cached( filename, encoding='utf8' ) {
  if (!(filename in cached_files)) {
    cached_files[filename] = fs.readFileSync(filename, encoding)
    console.log( `[template.js] loaded ${filename} into cache` )
  }
  if (cached_files[filename] == undefined) {
    delete cached_files[filename]
    throw `File not found "${filename}", cwd:${process.cwd()} cached:${filename in cached_files}`
  }
  return cached_files[filename];
}
module.exports.fs_readFileSync_cached = fs_readFileSync_cached;


