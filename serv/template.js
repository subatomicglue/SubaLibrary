const fs = require('fs');
const path = require('path');
const { fs_readFileSync_cached } = require('./common');

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
      let data2 = fs_readFileSync_cached(filename).replace( /^/gm, whitespace )
      let value = data( data2, vars ); // recurse in case there's variables or other includes. 
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
  let d = fs_readFileSync_cached( filename, "utf8" )
  return data( d, vars )
}

function init(l) {
  logger = l
}

module.exports.init = init;
module.exports.data = data;
module.exports.file = file;
