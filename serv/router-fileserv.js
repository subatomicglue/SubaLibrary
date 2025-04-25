const path = require('path');
const fs = require('fs');
const os = require('os');
const mime = require('mime-types');
const express = require("express");
const sanitizer = require('./sanitizer');
const sanitize = sanitizer.sanitize;

// const {
//   TITLE,
// } = require('./settings');

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
  return `[${req_user!=""?`${req_user}@`:""}${req_ip ? req_ip.replace(/^::ffff:/, '') : ""}]`
}

class FileServ {
  logger;
  router = express.Router();
  ALLOWED_EXTENSIONS;
  BROWSER_DIRECTORY;
  filelist = "use an * for all, this must be set...";

  constructor(options = { logger, browser_dir, cache, allowed_exts, filelist: "*" }) {
    this.logger = options.logger
    this.BROWSER_DIRECTORY = options.browser_dir
    this.ALLOWED_EXTENSIONS = new Set( options.allowed_exts )
    this.caching = options.cache
    this.filelist = options.filelist;
    sanitizer.init( options.logger, false );

    // [fileserv] Serve Files, from under the BROWSER_DIRECTORY (user input sanitized to ensure safety)
    if (this.filelist == "*") {
      this.router.get('*', (req, res) => {
        const req_path = decodeURIComponent( req.path )
        const sanitized = sanitize( this.BROWSER_DIRECTORY, req_path )
        const { relPath, fullPath, mimeType, ext } = sanitized;

        try {
          // Check if the requested path exists
          fs.accessSync(fullPath);

          // sanity on the sanity, one last guard.
          if (fullPath == "" || path.resolve(fullPath) != fullPath) {
            throw `unexpected ${fullPath}`
          }  

          // if the path points at a file, serv that up:
          if (isFile( fullPath )) {
            this.logger.info(`[fileserv] ${userLogDisplay(req.user, req.ip)} -> path:'${fullPath}' ext:'${ext}' mime:'${mimeType}'`);
            if (!this.ALLOWED_EXTENSIONS.has(ext)) {
              this.logger.warn(`[error] ${req.ip} -> 403 - Forbidden: File type not allowed: ${fullPath} (${ext})`);
                return res.status(403).send('403 - Forbidden: File type not allowed');
            }

            // Set headers to force download
            //res.setHeader('Content-Disposition', `attachment; filename="${path.basename(fullPath)}"`); // force browser to download
            res.setHeader('Content-Disposition', 'inline'); // open in browser
            res.setHeader('Content-Type', mimeType);
            if (this.caching) // if caching, otherwise it'll get fetched each time.
              res.setHeader('Cache-Control', `public, max-age=${24 * 60 * 60}, immutable`); // Cache for 24 hours
            res.sendFile(fullPath);
            return
          }

          this.logger.warn(`[fileserv]    ${userLogDisplay(req.user, req.ip)} -> 404 Not Found: '${req_path}' -> '${fullPath}' (is directory)`);
          res.status(404).send('404 - Not Found');
          return
        } catch (error) {
          this.logger.warn(`[fileserv]    ${userLogDisplay(req.user, req.ip)} -> 404 Not Found: '${req_path}' -> '${fullPath}', ${error}`);
          res.status(404).send('404 - Not Found');
          return
        }
      });
    } else if (Array.isArray( this.filelist )) {
      // construct individual routes, no wildcard "*" here.
      for (let asset of this.filelist) {
        this.router.get(`${asset}`, (req, res, next) => {
          const req_path = asset
          this.logger.info(`[fileserv]   ${req_path}`);

          const sanitized = sanitize( this.BROWSER_DIRECTORY, req_path )
          const { relPath, fullPath, mimeType, ext } = sanitized;
      
          this.logger.info(`[fileserve]   ${userLogDisplay(req.user, req.ip)} -> '${req.path}' -> '${fullPath}'`);
          try {
            // Check if the requested path exists
            fs.accessSync(fullPath);

            // sanity on the sanity, one last guard.
            if (fullPath == "" || path.resolve(fullPath) != fullPath) {
              throw `unexpected ${fullPath}`
            }

            if (isFile( fullPath )) {
              res.setHeader('Content-Disposition', 'inline'); // open in browser
              res.setHeader('Content-Type', mimeType);
              if (this.caching) // if caching, otherwise it'll get fetched each time.
                res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
              res.sendFile(fullPath);
              return
            }
          } catch (error) {
            this.logger.warn(`[fileserv]    ${userLogDisplay(req.user, req.ip)} -> 404 Not Found: '${req_path}' -> '${fullPath}', ${error}`);
            return res.status(404).send('404 - Not Found');
          }
          next(); // we're not serving the entire baseUrl route, / dir for "asset", so defer to whoever's next in the express middleware.
        })
      }
    }
  } // constructor
} // class


// Plug into Express
module.exports = (options = { logger: console.log, browser_dir: "./this-is-undefined-please-set-BROWSER_DIRECTORY", cache: false, allowed_exts: [], filelist: "*" }) => {
  return new FileServ( options );
}
