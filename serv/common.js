// call it like:
// userLogDisplay( req )
// or
// userLogDisplay( username_str, ipaddr_str )
function userLogDisplay(req_object_or_user_str, req_ip_str) {
  let req_user = req_object_or_user_str == undefined ? "system" : typeof req_object_or_user_str == "object" ? req_object_or_user_str.user : req_object_or_user_str
  let req_ip = req_object_or_user_str == undefined ? "127.0.0.1" : typeof req_object_or_user_str == "object" ? req_object_or_user_str.ip : req_ip_str
  return `[${req_user!=""?`${req_user}@`:""}${req_ip.replace(/^::ffff:/, '')}]`
}
module.exports.userLogDisplay = userLogDisplay;
