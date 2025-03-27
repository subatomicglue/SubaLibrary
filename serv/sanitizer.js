const path = require('path');
const mime = require('mime-types');

let ALLOW_DOTFILES = false;

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

///////////////////////////////////////////////////////////////////////////////
// AUTO TEST
///////////////////////////////////////////////////////////////////////////////

function run_tests() {
  // auto tests:
  function test_filterInvalidPaths( p, expected_result ) {
    let pp = ___filterInvalidPaths( p );
    if (expected_result != pp) {
      let msg = `['${p}', '${expected_result}']  expected '${expected_result}', got '${pp}'`;
      logger.error(`[auto test] : ${msg}`);
      throw `unexpected result in test_filterInvalidPaths ${msg}`
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

  function test_sanitize( p, expected_result ) {
    let pp = sanitize( "/some/base/dir", p ).relPath;
    if (expected_result != pp) {
      let msg = `['${p}', '${expected_result}']  expected '${expected_result}', got '${pp}'`;
      logger.error(`[auto test] : ${msg}`);
      throw `unexpected result in test_sanitize ${msg}`
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
}

///////////////////////////////////////////////////////////////////////////////
// EXPORT THE API
///////////////////////////////////////////////////////////////////////////////

function init( l, ALLOW_DOTFILES_CONFIG = false ) {
  logger = l;
  ALLOW_DOTFILES = ALLOW_DOTFILES_CONFIG;
  run_tests();
}

module.exports.init = init;
module.exports.sanitize = sanitize;
