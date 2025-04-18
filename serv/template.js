const fs = require('fs');
const path = require('path');

let cached_files = {} // key is the filename
let logger;

function data( d, vars = {} ) {
  const VERBOSE = false;
  d = d.replace(/<%=\s*([^\s%>]+)\s*%>/g, (match, key) => {
    let value = key in vars ? vars[key] : `!!! ${key} not set !!!`;
    VERBOSE && logger.info(`[template] replacing: '${key}' -> '${value.substring(0, 32)}'`);
    return value;
  });
  d = d.replace(/([\t ]*)<%include\s+(["'`])([^"'`]+)\2\s*%>/g, (match, whitespace, quotetype, filename) => {
    try {
      if (!(filename in cached_files))
        cached_files[filename] = fs.readFileSync(filename, 'utf8').replace( /^/gm, whitespace )
      if (cached_files[filename] == undefined)
        throw `File not found "${filename}", cwd:${process.cwd()} cached:${filename in cached_files}`
      let value = data( cached_files[filename], vars ); // recurse in case there's variables or other includes. 
      VERBOSE && logger.info(`[template] replacing: 'include ${filename}' -> '${value.replace(/^[\n\s]+/m, '').replace(/\n.*/gm, '' ).substring(0, 64)}'`);
      return value; // Read file contents
    } catch (error) {
      console.log( `Error: Could not include "${filename}"`, error )
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
