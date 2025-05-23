function userLogDisplay(req_user, req_ip) {
  return `[${req_user!=""?`${req_user}@`:""}${req_ip.replace(/^::ffff:/, '')}]`
}
module.exports.userLogDisplay = userLogDisplay;
