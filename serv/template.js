const fs = require('fs');
const path = require('path');

let cached_files = {} // key is the filename
let logger;

function data( d, vars = {} ) {
  d = d.replace(/<%=\s*([^\s]+)\s*%>/g, (match, key) => {
    let value = key in vars ? vars[key] : `!!! ${key} not set !!!`;
    logger.info(`[template] replacing: '${key}' -> '${value.substring(0, 32)}'`);
    return value;
  });
  d = d.replace(/<%include\s+(["'`])([^"'`]+)\1\s*%>/g, (match, quotetype, filename) => {
    try {
      if (!filename in cached_files)
        cached_files[filename] = fs.readFileSync(filename, 'utf8')
      let value = data( cached_files[filename], vars ); // recurse in case there's variables or other includes. 
      logger.info(`[template] replacing: 'include ${filename}' -> '${value.substring(0, 32)}'`);
      return ; // Read file contents
    } catch (error) {
      return `<!-- Error: Could not include "${filename}" -->`; // Handle missing files
    }
  });
  return d
}

function file( filename, vars = {} ) {
  let d = fs.readFileSync( filename, "utf8" )
  return data( d, vars )
}

function init(l) {
  logger = l
}

module.exports.init = init;
module.exports.data = data;
module.exports.file = file;
