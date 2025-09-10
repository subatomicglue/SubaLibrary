const fs = require('fs');
const path = require('path');
const { fs_readFileSync_cached } = require('./common');

let logger;
let indent = 0;

function data( d, vars = {} ) {
  const VERBOSE = false;
  d = d.replace(/<%=\s*([^\s%>]+)(?:\s+([a-zA-Z0-9_ ]+))?\s*%>/g, (match, key, options) => {
    options = options ? options.split(' ') : []; // check for options like: options.includes( "force" ) 
    let value = key in vars ? vars[key] : ((options.includes( "optional" )) ? '' : `!!! ${key} not set !!!`);
    indent++;
    value = data( value, vars ); // recurse in case there's variables or other includes. 
    indent--;
    VERBOSE && console.log(' '.repeat(indent*2) + `[template] replacing: '${key}' -> '${value.replace(/\n/g, '\\n').substring(0, 32)}'`);
    return value;
  });
  d = d.replace(/([\t ]*)<%include\s+(["'`])([^"'`]+)\2(?:\s+([a-zA-Z0-9_ ]+))?\s*%>/g, (match, whitespace, quotetype, filename, options) => {
    try {
      options = options ? options.split(' ') : []; // check for options like: options.includes( "force" ) 
      let data2 = (options.includes( "force" ) ? fs.readFileSync( filename, "utf8" ) : fs_readFileSync_cached(filename)).replace( /^/gm, whitespace ) // indent the included file...
      indent++;
      let value = data( data2, vars ); // recurse in case there's variables or other includes. 
      indent--;
      VERBOSE && console.log(' '.repeat(indent*2) + `[template] replacing: [${whitespace}] 'include ${filename}' -> '${value.replace(/^[\n\s]+/m, '').replace(/\n.*/gm, '' ).substring(0, 64)}'`);
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
