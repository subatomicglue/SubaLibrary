const path = require('path');

// required settings
const config = require('./soma-serv.json');

// optional settings
let USERS_WHITELIST;
try {USERS_WHITELIST = require('./users.json')} catch(error) {console.log( "INFO: you may define users.json with { 'username': 'pass' } format" )}
let SECRET_PASSCODE;
try {SECRET_PASSCODE = require('./passcode.json')} catch(error) {console.log( "INFO: you may define passcode.json with \"<your passcode here>\" format" )}

// export settings
module.exports = {
  ...config,        // Spread all values from the config file

  // Override config, with custom settings (these will take precedence)
  PUBLIC_DIR: path.resolve(config.PUBLIC_DIR), // resolve to absolute path
  LOGS_DIR: path.resolve(config.LOGS_DIR), // resolve to absolute path
  PORT: process.env.NODE_PORT || config.PORT_DEFAULT, // Override default port with environment variable
  ALLOWED_EXTENSIONS: new Set(config.ALLOWED_EXTENSIONS), // Convert to Set for faster lookup
  ASSETS_DIR: path.resolve(config.ASSETS_DIR), // resolve to absolute path
  ASSETS_MAGIC: "____aSsEtS____", // Magic URL key for pulling assets
  isPM2: process.env.pm_id !== undefined,
  MAX_PATH_LENGTH: config.MAX_PATH_LENGTH || 4096, // Default if not in config

  // few extras we want in our settings
  USERS_WHITELIST,
  SECRET_PASSCODE,
};
