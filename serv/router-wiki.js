const fs = require("fs");
const path = require("path");
const express = require("express");
const router = express.Router();
const sanitizer = require('./sanitizer');
const { sanitize, sanitizeFloat, sanitizeInt, sanitizeTopic } = sanitizer;
const template = require('./template');
const { markdownToHtml, htmlToMarkdown, extractFirstImage } = require('./markdown')
const { init: markdownTests } = require('./markdown-tests')
markdownTests();
const { guardForProdHostOnly, redirectAnonUsersToStaticSite } = require("./router-auth");
const { userLogDisplay, getReferrerFromReq } = require("./common")

const {
  TITLE,
  PUBLIC_DIR,
  LOGS_DIR,
  ASSETS_DIR,
  ALLOWED_EXTENSIONS,
  RATE_LIMIT_WINDOW_SECS,
  RATE_LIMIT_WINDOW_MAX_REQUESTS,
  MAX_PATH_LENGTH,
  USE_HTTPS,
  ALLOW_DOTFILES,
  VERBOSE,
  USERS_WHITELIST,
  SECRET_PASSCODE,
  ASSETS_MAGIC,
  isPM2,
  WIKI_DIR,
  WIKI_FILES_DIR,
  USER_ANON_DISPLAY,
  HOSTNAME_FOR_STATIC,
  HOSTNAME_FOR_EDITS,
  YOUTUBE_TRANSCRIPTS_DIR,
  WIKI_CHANGELOG_TOPICNAME,
  ADDITIONAL_YOUTUBE_SEARCH_BUTTONS,
  ADDITIONAL_WIKI_SEARCH_BUTTONS,
  DOMAINS,
} = require('./settings');

const { writeToChangeLog } = require( "./ChangeLog.js" )

let logger;

// routes (must end in /)
const view_route="/view"
const edit_route="/edit"
const diff_route="/diff"
const uploads_file_serv_url_prefix = '/uploads/files';
const uploads_image_serv_url_prefix = '/uploads';
const regex_match_fullversion_md = /^[^.]+\.md$/;
const WIKI_DIR_LATEST = `${WIKI_DIR}`
const WIKI_DIR_VERSIONED = `${WIKI_DIR}/versioned`

// Ensure wiki directory exists
if (!fs.existsSync(WIKI_DIR)) {
    fs.mkdirSync(WIKI_DIR, { recursive: true });
}
if (!fs.existsSync(WIKI_DIR_LATEST)) {
    fs.mkdirSync(WIKI_DIR_LATEST, { recursive: true });
}
if (!fs.existsSync(WIKI_DIR_VERSIONED)) {
    fs.mkdirSync(WIKI_DIR_VERSIONED, { recursive: true });
}

function isLoggedIn( req ) {
  return !(req.user == undefined || req.user == USER_ANON_DISPLAY)
}



function wrapWithFrame(content, topic, req, firstimage = undefined, t=new Date()) {
  return template.file( "template.page.html", {
    ...require('./settings'), ...{ CANONICAL_URL: req.canonicalUrl, CANONICAL_URL_ROOT: req.canonicalUrlRoot, CANONICAL_URL_DOMAIN: req.canonicalUrlDomain, CURRENT_DATETIME: t.toISOString().replace(/\.\d{3}Z$/, '+0000') },
    TITLE: `${TITLE}`,
    SOCIAL_TITLE: `${TITLE}${(topic != "index") ? ` - ${topic}` : ""}`,
    SOCIAL_IMAGE: firstimage ? `${req.canonicalUrlRoot.replace(/\/+$/,'')}${firstimage}` : `${req.canonicalUrlRoot}/${require('./settings').ASSETS_MAGIC}/${require('./settings').SOCIAL_IMAGE}`, // Default social image path
    // ASSETS_MAGIC,
    BACKBUTTON_PATH: `/`,
    BACKBUTTON_VISIBILITY: `visible`,//`hidden`,
    BACKBUTTON_IMAGE: `/${ASSETS_MAGIC}/home_24dp_E3E3E3_FILL0_wght400_GRAD0_opsz24.svg`,
    PAGE_TITLE: `<a href="${req.baseUrl}${view_route}">/</a>${topic} ${isLoggedIn( req ) ? `(<a href="${req.baseUrl}${edit_route}/${topic}">edit</a>)`:``}`,
    USER: `${req.user}`,
    SCROLL_CLASS: "scroll-child-wiki",
    WHITESPACE: "normal",
    REQ_BASEURL: req.baseUrl,
    SEARCH_URL: `${req.baseUrl}/search`,
    BODY: `<%include "template.page-search.html"%><div id="the-scroll-page" style="max-width: 60rem; margin-left: auto; margin-right: auto; padding-left: 2em;padding-right: 2em;padding-top: 1em;padding-bottom: 1em;">${content}</div>`,
    USER_LOGOUT: (!isLoggedIn( req )) ?
`<a id="signin-link" style="color: grey;" href="/login">&nbsp;signin</a>` :
`<a id="signin-link" title="[signout]" alt="[signout]" style="color: grey;" href="/logout">&nbsp;<span id="username-span" style="white-space: nowrap; overflow: hidden; display: inline-block; max-width: 11ch; position: relative; vertical-align:bottom">${req.user}<span id="gradient-span" style="content: ''; position: absolute; right: 0; top: 0; bottom: 0; width: 2rem; background: linear-gradient(to right, transparent, #333);"></span></span></a>
<script>
  // current username is constrained by max-width, overflow of that width results in gradient (because elipsis is really wide).
  // here, we add/remove the gradient based on overflow
  document.addEventListener("DOMContentLoaded", function() {
      const usernameSpan = document.getElementById('username-span');
      const gradientSpan = document.getElementById('gradient-span');
      // Check if text content has overflowed
      // Toggle gradient visibility based on overflow
      const isOverflowing = usernameSpan.scrollWidth > usernameSpan.clientWidth;
      if (!isOverflowing) {
          gradientSpan.style.display = 'none';
      } else {
          gradientSpan.style.display = 'inline';
      }
  });
<\/script>
`,
    SEARCH: `<span id="search" onclick='search()'><img src="/${ASSETS_MAGIC}/search_24dp_E3E3E3_FILL0_wght400_GRAD0_opsz24.svg" alt="[search]" title="[search]"></span>`,
    // REFERRER: getReferrerFromReq( req )
    ROBOTS_PREFIX: req.canonicalHost ? `` : 'NO'
  })
}

function readdirSync(dirPath, regex) {
  const files = fs.readdirSync(dirPath);
  // logger.error(`[wiki] readdirSync dirPath:${dirPath} list:${JSON.stringify( files )}`);
  return files.filter(file => {
    let result = regex.test(file)
    // logger.error(`[wiki] files.filter  regex:${regex} file:${file} result:${result}`);
    return result
  });
}

function escapeRegex(str) {
  return str.replace(/[.*+?^=!:${}()|\[\]\/\\]/g, '\\$&');
}


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// endpoints
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// general guard, filter anything unexpected or unsupported by the app
router.use((req, res, next) => {
  const req_path = decodeURIComponent( req.path )
  //logger.warn(`[wiki guard] ${userLogDisplay(req)} : base:${req.baseUrl} path:${req_path} - TODO set up the guards!`);

  // wiki under development... todo: set this section up.
  next();
  return

  if (req.params[0] && req.params[0].length > MAX_PATH_LENGTH) {
    return res.status(500).json({ error: "Path length exceeded the limit." });
  }

  if (Object.keys(req.query).length > 0) {
    // for (let key in req.query) {
    //   if (req.query[key] && req.query[key].length > MAX_PATH_LENGTH) {
    //     return res.status(500).json({ error: `Query parameter '${key}' is too long` });
    //   }
    // }
    return res.status(500).json({ error: `Query parameter '${Object.keys(req.query)}' is too long >0` });
  }

  if (req.body && Object.keys(req.body).length > 0) {
  //for (let key in req.body) {
  //  if (req.body[key] && typeof req.body[key] === 'string' && req.body[key].length > MAX_PATH_LENGTH) {
  //    return res.status(500).json({ error: `Body parameter '${key}' is too long` });
  //  }
    return res.status(500).json({ error: `Body parameter '${Object.keys(req.body)}' is too long` });
  }

  let acceptable_headers = { 'content-type': ["application/x-www-form-urlencoded"] }
  if (req.headers['content-type'] && !acceptable_headers['content-type'].includes( req.headers['content-type'] )) {
    logger.warn(`[content-type BLOCK] : Unexpected headers detected -> content-type:${req.headers['content-type']}`);
    return res.status(500).json({ error: `Unexpected headers detected. ${JSON.stringify( Object.keys( req.headers ) )} ${req.headers['content-type']}` });
  }

  next();
});

// DEFAULT (redirects to "view")
router.get(`/`, (req, res) => {
  res.redirect(`${req.baseUrl}${view_route}`);  // Redirects to another route in the same app
});

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')  // Must come first
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

const { diffLines, diffWords } = require( 'diff' );

function diffLines_toMarkdown(oldText, newText) {
  const changes = diffLines(oldText, newText);
  let result = '';

  changes.forEach(part => {
    if (part.added) {
      result += part.value
        .split('\n')
        .map(line => line && `+ ${line}`)
        .join('\n') + '\n';
    } else if (part.removed) {
      result += part.value
        .split('\n')
        .map(line => line && `- ${line}`)
        .join('\n') + '\n';
    } else {
      result += part.value
        .split('\n')
        .map(line => line && `  ${line}`)
        .join('\n') + '\n';
    }
  });

  return '```diff\n' + result.trimEnd() + '\n```';
}

function diffWords_toHTML(oldText, newText) {
  const changes = diffWords(oldText, newText);
  let result = '';

  changes.forEach(part => {
    if (part.added) {
      result += part.value
        .split('\n')
        .map(line => line ? line.replace(/^(\s*)(.*?)(\s*)$/, `$1<b id="diff" style="background-color:lightgreen">$2</b>$3` ) : '<b id="diff" style="background-color:lightgreen">&lt;------:: newline added ::-------&gt;</b>' )
        .join('\n');
    } else if (part.removed) {
      result += part.value
        .split('\n')
        .map(line => line ? line.replace(/^(\s*)(.*?)(\s*)$/, `$1<strike id="diff" style="background-color:pink">$2</strike>$3` ) : '<strike id="diff" style="background-color:pink">&lt;------:: newline removed ::-------&gt;</strike>' )
        .join('\n');
    } else {
      result += part.value;
    }
  });

  return result.trim();
}

// Find the next version number of the wiki .md file
function findNextVersion( wiki_dir, topic ) {
  let existing_versions = readdirSync( wiki_dir, new RegExp( `^${topic}\\.?[0-9]*\\.md$` ) );
  let version = existing_versions.length == 0 ? 1 : existing_versions.length + 1; // they start at 1, so we need N + 1
  return version
}

// VIEW
// GET ${req.baseUrl}${view_route}/:topic?/:version?  (get the page view as HTML)
router.get(`${view_route}/:topic?/:version?`, redirectAnonUsersToStaticSite(HOSTNAME_FOR_EDITS), (req, res) => {
  //logger.info(`[wiki] ${userLogDisplay(req)} RAW from the URL | topic:${req.params.topic} version:${req.params.version}`);
  const { topic, version, searchterm/*, diff*/ } = {
    topic: sanitizeTopic( decodeURIComponent( req.params.topic ? `${req.params.topic}` : "index" ) ),  // Default to index if no topic provided
    version: req.params.version ? `.${sanitizeInt( decodeURIComponent( req.params.version ) )}` : "", // Default to empty string if no version provided
    searchterm: req.query.searchterm ? req.query.searchterm : "",
    // diff: req.query.diff ? `.${sanitizeInt( decodeURIComponent( req.query.diff ) )}` : "",
  };
  //${diff!=""?` diff:${diff}`:``}
  logger.info(`[wiki] ${userLogDisplay(req)} ${view_route}/${topic}${version != "" ?`/${version}`:''}${searchterm!=""?` searchterm:${searchterm}`:``}`);

  const filePath = sanitize( version == "" ? WIKI_DIR_LATEST : WIKI_DIR_VERSIONED, `${topic}${version}.md`).fullPath
  if (filePath == "") {
    logger.error(`[wiki] ${userLogDisplay(req)} ${view_route}/ 403 Forbidden '${topic}'`);
    return res.status(403).send(`Forbidden`);
  }
  if (!fs.existsSync(filePath)) {
    logger.info(`[wiki] ${userLogDisplay(req)} ${view_route}/${topic}${version != "" ?`/${version}`:''} NOT FOUND: ${topic}${version}.md`);
    //return res.status(404).send("Topic not found.");
    const editUrl = `${req.baseUrl}${edit_route}/${topic}`;
    if (isLoggedIn( req )) {
      return res.redirect(`${editUrl}`);
      //return res.send(`
      //  <p>Topic "${topic}" not found.</p>
      //  <p><a href="${editUrl}">Click here</a> to create or edit this topic.</p>
      //`);
    } else {
      return res.send(`
        <p>Topic "${topic}" not found.</p>
        <a href="${req.get('Referer')}">Go Back...</a>
      `);
    }
  }

  let markdown = fs.readFileSync( filePath, "utf8" );
  const html = wrapWithFrame( markdownToHtml(markdown, `${req.baseUrl}${view_route}`, {
    userdata: USERS_WHITELIST,
  }), topic, req, extractFirstImage( markdown, 10 ) );
  res.send( html );
});

// RENAME
// GET /wiki/rename/:topic?  — show rename form
// POST /wiki/rename         — perform rename (includes versioned files)
router.get("/rename/:topic?", guardForProdHostOnly(HOSTNAME_FOR_EDITS), (req, res) => {
  const topic = sanitizeTopic(decodeURIComponent(req.params.topic || "index"));
  const filePath = sanitize(WIKI_DIR_LATEST, `${topic}.md`).fullPath;

  // topic not found
  if (!fs.existsSync(filePath)) {
    logger.info(`[wiki] ${userLogDisplay(req)} /rename GET — topic not found: ${topic}`);
    return res.status(404).send(`<p>Topic "${topic}" not found.</p><a href="${req.baseUrl}${view_route}/${topic}">Go Back</a>`);
  }

  const formHtml = `
    <h1>Rename Topic</h1>
    <form method="POST" action="${req.baseUrl}/rename">
      <input type="hidden" name="oldTopic" value="${topic}" />
      <label>New Topic Name:</label><br/>
      <input type="text" name="newTopic" value="${topic}" required/><br/><br/>
      <button type="submit">Rename</button>
    </form>
    <p><a href="${req.baseUrl}${view_route}/${topic}">Cancel</a></p>
  `;
  res.send(formHtml);
});

router.post("/rename", guardForProdHostOnly(HOSTNAME_FOR_EDITS), express.urlencoded({ extended: true }), (req, res) => {
  const oldTopic = sanitizeTopic(decodeURIComponent(req.body.oldTopic || ""));
  const newTopic = sanitizeTopic(decodeURIComponent(req.body.newTopic || ""));

  if (!oldTopic || !newTopic) {
    logger.warn(`[wiki] ${userLogDisplay(req)} /rename POST — missing topic(s): old='${oldTopic}' new='${newTopic}'`);
    return res.status(400).send("Invalid request. Both old and new topic names are required.");
  }

  const oldPath = sanitize(WIKI_DIR_LATEST, `${oldTopic}.md`).fullPath;
  const newPath = sanitize(WIKI_DIR_LATEST, `${newTopic}.md`).fullPath;

  // topic not found
  if (!fs.existsSync(oldPath)) {
    logger.info(`[wiki] ${userLogDisplay(req)} /rename POST — old topic not found: ${oldTopic}`);
    return res.status(404).send(`<p>Topic "${oldTopic}" not found.</p>`);
  }

  // check for potential collision(s) when renaming to the newTopic name.
  const versionedCollisions = fs.readdirSync(WIKI_DIR_VERSIONED).filter(f => f.match(new RegExp(`^${newTopic}\\.\\d+\\.md$`)));
  if (fs.existsSync(newPath) || versionedCollisions.length > 0) {
    logger.warn(`[wiki] ${userLogDisplay(req)} /rename POST — new topic already exists: ${newTopic}`);
    return res.status(409).send(`<p>Topic "${newTopic}" already exists.</p><BR>exists=${fs.existsSync(newPath)}<BR>versionedCollisions=${JSON.stringify(versionedCollisions)}`);
  }

  try {
    // --- Rename the main (latest) file ---
    fs.renameSync(oldPath, newPath);
    logger.info(`[wiki] ${userLogDisplay(req)} /rename POST — renamed '${oldTopic}.md' → '${newTopic}.md'`);

    // --- Rename any versioned files ---
    const versionedFiles = fs.readdirSync(WIKI_DIR_VERSIONED).filter(f => f.match(new RegExp(`^${oldTopic}\\.\\d+\\.md$`)));
    versionedFiles.forEach(file => {
      const oldVersionPath = sanitize(WIKI_DIR_VERSIONED, file).fullPath;
      const versionMatch = file.match(/\.(\d+)\.md$/);
      const version = versionMatch ? versionMatch[1] : null;
      if (!version) return; // skip malformed
      const newVersionFile = `${newTopic}.${version}.md`;
      const newVersionPath = sanitize(WIKI_DIR_VERSIONED, newVersionFile).fullPath;

      fs.renameSync(oldVersionPath, newVersionPath);
      logger.info(`[wiki] ${userLogDisplay(req)} /rename POST — versioned '${file}' → '${newVersionFile}'`);
    });

    // --- Done ---
    logger.info(`[wiki] ${userLogDisplay(req)} /rename POST — completed rename of '${oldTopic}' and all versioned files to '${newTopic}'`);
    writeToChangeLog( req, `Renamed Topic '[${oldTopic}](${req.baseUrl}${view_route}/${oldTopic})' to '[${newTopic}](${req.baseUrl}${view_route}/${newTopic})'` )
    return res.redirect(`${req.baseUrl}${view_route}/${newTopic}`);

  } catch (err) {
    logger.error(`[wiki] ${userLogDisplay(req)} /rename POST — rename failed: ${err.message}`);
    return res.status(500).send("Failed to rename topic due to server error.");
  }
});


// DIFF
// GET ${req.baseUrl}${diff_route}/:topic?/:version_new/:version_old/  (get the page view as HTML)
router.get(`${diff_route}/:topic?/:version_new/:version_old/`, (req, res) => {
  const { topic, version_new, version_old } = {
    topic: sanitizeTopic( decodeURIComponent( req.params.topic ? `${req.params.topic}` : "index" ) ),  // Default to index if no topic provided
    version_new: req.params.version_new ? `.${sanitizeInt( decodeURIComponent( req.params.version_new ) )}` : "", // Default to empty string if no version provided
    version_old: req.params.version_old ? `.${sanitizeInt( decodeURIComponent( req.params.version_old ) )}` : "", // Default to empty string if no version provided
  };
  logger.info(`[wiki] ${userLogDisplay(req)} ${diff_route}/${topic}${version_new != "" ?`/${version_new}`:''}${version_old!=""?`/${version_old}`:``}`);

  const filePath_new = sanitize( WIKI_DIR_VERSIONED, `${topic}${version_new}.md`).fullPath
  const filePath_old = sanitize( WIKI_DIR_VERSIONED, `${topic}${version_old}.md`).fullPath
  if (filePath_new == "" || filePath_old == "") {
    logger.error(`[wiki] ${userLogDisplay(req)} ${diff_route}/ 403 Forbidden${filePath_new == "" ? ` ${topic}.${version_new}`:""}${filePath_old == "" ? ` ${topic}.${version_old}`:""}`);
    return res.status(403).send(`Forbidden`);
  }
  if (!fs.existsSync(filePath_new)) {
    logger.info(`[wiki] ${userLogDisplay(req)} ${diff_route}/${topic}${version_new != "" ?`/${version_new}`:''} NOT FOUND: ${filePath_new}.md`);
    return res.status(404).send( "Not found." );
  }
  if (!fs.existsSync(filePath_old)) {
    logger.info(`[wiki] ${userLogDisplay(req)} ${diff_route}/${topic}${version_old != "" ?`/${version_old}`:''} NOT FOUND: ${filePath_old}.md`);
    return res.status(404).send( "Not found." );
  }

  let markdown_new = fs.readFileSync(filePath_new, "utf8");
  let markdown_old = fs.readFileSync(filePath_old, "utf8");
  //markdown = diffLines_toMarkdown( markdown_older, markdown )
  let html = diffWords_toHTML( escapeHtml( markdown_old ), escapeHtml( markdown_new ) )
  html = wrapWithFrame(`<p><a href="${req.baseUrl}${view_route}/${topic}/${version_new.replace(/^\./,'')}">View ${version_new.replace(/^\./,'')}</a> <a href="${req.baseUrl}${view_route}/${topic}/${version_old.replace(/^\./,'')}">View ${version_old.replace(/^\./,'')}</a> </p><pre style="border: 1px solid #ccc; background: #f6f6fa; padding: 1em; overflow-x: auto;"><code>`+ html +"</code></pre>", topic, req);
  res.send(html);
});

// filter things we dont want to land on the filesystem
function sanitizeMarkdown( markdown ) {
  return markdown.replace(/\u00A0/g, ' ') // non-breaking spaces aren't allowed.   User can use &nbsp; if they need one.
}

// SAVE
// PUT /save   (write page markdown;  req.body: { topic: "TOPICNAME", content: "Markdown content" })
router.put("/save", guardForProdHostOnly(HOSTNAME_FOR_EDITS), express.json({ limit: '50mb' }), (req, res) => {
  const { topic, content, save_version } = {
    topic: sanitizeTopic( req.body.topic ),
    content: sanitizeMarkdown( req.body.content ),
    save_version: req.body.version,
  }
  if (!topic || !content) {
    logger.error(`[wiki] ${userLogDisplay(req)} /save 400 Missing topic or content`);
    return res.status(400).send("Missing topic or content.");
  }

  if (topic == "" || sanitizeTopic( topic ) != topic) {
    logger.error(`[wiki] ${userLogDisplay(req)} /save 403 Forbidden '${topic}'`);
    return res.status(403).send(`Forbidden`);
  }
  if (topic == "ChangeLog") {
    writeToChangeLog( req, `Attempted to Edit '[${topic}](${req.baseUrl}${view_route}/${topic})'` )
    return res.json({ message: "Wiki page did not change.", version: 0 });
  }
  logger.info(`[wiki] ${userLogDisplay(req)} /save ${topic} content (save)`);

  // Find the next version number
  let version = findNextVersion( WIKI_DIR_VERSIONED, topic );
  if (version != undefined && version != save_version) {
    const message = `Your local copy of '${topic}' v${save_version} is older than server's v${version}.  It appears someone saved the same topic you're working on.\n - If you save, it will overwrite a newer version.\n - To be safe: Carefully copy/paste your markdown out to another app, and [cancel] here...`;
    logger.error(`[wiki] ${userLogDisplay(req)} /save 409 Conflict.  ${message}`);
    return res.status(409).json({ message: `Conflict ${message}`, version: version } );
  }

  // debugging... break out early
  // logger.error(`[wiki] /save Debugging found:${existing_versions.length} next_version:${version} list:${JSON.stringify( existing_versions )}`);
  // return res.status(403).send(`Debugging found:${existing_versions.length} next_version:${version} list:${JSON.stringify( existing_versions )}`);

  const latestFilePath = sanitize( WIKI_DIR_LATEST, `${topic}.md`).fullPath
  if (latestFilePath == "") {
    logger.error(`[wiki] ${userLogDisplay(req)} /save 403 Forbidden '${topic}'`);
    return res.status(403).send(`Forbidden`);
  }

  // bail early if the content didn't change
  if (fs.existsSync(latestFilePath)) {
    const latest_file_contents = fs.readFileSync(latestFilePath, "utf8");
    if (content == latest_file_contents) {
      return res.json({ message: "Wiki page did not change.", version: version - 1 });
    }
  }

  const versionedFilePath = sanitize( WIKI_DIR_VERSIONED, `${topic}.${version}.md`).fullPath
  if (versionedFilePath == "") {
    logger.error(`[wiki] ${userLogDisplay(req)} /save 403 Forbidden '${topic}'`);
    return res.status(403).send(`Forbidden`);
  }

  logger.info(`[wiki] ${userLogDisplay(req)} /save ${topic} ${version} version (save)`);
  fs.writeFileSync(versionedFilePath, content, "utf8");
  fs.writeFileSync(latestFilePath, content, "utf8");
  writeToChangeLog( req, `Edited '[${topic}](${req.baseUrl}${view_route}/${topic})' to [v${version}](${req.baseUrl}${diff_route}/${topic}/${version}${version>1?`/${version-1}#diff`:``})` )
  res.json({ message: "Wiki page updated.", version });
});

// EDIT
// GET ${req.baseUrl}${edit_route}/:topic    (edit page)
router.get(`${edit_route}/:topic`, guardForProdHostOnly(HOSTNAME_FOR_EDITS), (req, res) => {
  const topic = req.params.topic ? sanitizeTopic( decodeURIComponent( req.params.topic ) ) : undefined;
  if (!topic) {
    logger.error(`[wiki] ${userLogDisplay(req)} ${edit_route} 400 Missing topic name`);
    return res.status(400).send("Missing topic name.");
  }

  const filePath = sanitize( WIKI_DIR_LATEST, `${topic}.md` ).fullPath
  if (filePath == "") {
    logger.error(`[wiki] ${userLogDisplay(req)} ${edit_route} 403 Forbidden '${topic}'`);
    return res.status(403).send(`Forbidden`);
  }

  // Find the next version number (so we can tell the frontend user, their local cache is older than on server)
  // this is the version being edited (n+1), not the last version saved (n)
  let version = findNextVersion( WIKI_DIR_VERSIONED, topic );

  logger.info(`[wiki] ${userLogDisplay(req)} ${edit_route} ${topic} ${filePath}`);
  const markdown = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : `# ${topic}\n\n\n`;
  let t = new Date();
  res.send(template.file( "template.wiki-edit.html", {
      ...require('./settings'), ...{ CANONICAL_URL: req.canonicalUrl, CANONICAL_URL_ROOT: req.canonicalUrlRoot, CANONICAL_URL_DOMAIN: req.canonicalUrlDomain, CURRENT_DATETIME: t.toISOString().replace(/\.\d{3}Z$/, '+0000') },
      TITLE: `${TITLE}`,
      SOCIAL_TITLE: `${TITLE}${(topic != "index") ? ` - ${topic}` : ""}`,
      ASSETS_MAGIC,
      SCROLL_CLASS: "scroll-child-wiki",
      WHITESPACE: "normal",
      //USER_LOGOUT: (req.user == undefined || req.user == USER_ANON_DISPLAY) ? `<a id="signin-link" style="color: grey;" href="/login">&nbsp;signin</a>` : `<a id="signin-link" style="color: grey;" href="/logout">&nbsp;${req.user}&nbsp;signout</a>`,
      req_baseUrl:req.baseUrl,
      topic,
      view_route,
      edit_route,
      description: markdown.length == 0 ? `Reload as <a href="<%=req_baseUrl%><%=edit_route%>2/<%=topic%>">natural</a> &nbsp; &nbsp; &nbsp;` : '',
      // description: markdown.length == 0 ? `For Precise Editing &amp; HTML Paste.   (Reload as <a href="<%=req_baseUrl%><%=edit_route%>2/<%=topic%>">natural</a> for simple/wysiwyg editing)` : '',
      markdown: markdown.replace(/&/g, "&amp;"),
      markdown_version: version, // version being edited (n+1), not the last version saved (n)
    })
  );
});

// GET /markdown/:topic/:version?   (get the page markdown data)
router.get("/markdown/:topic/:version?", guardForProdHostOnly(HOSTNAME_FOR_EDITS), (req, res) => {
  const { topic, version } = {
    topic: req.params.topic ? sanitizeTopic( decodeURIComponent( `${req.params.topic}` ) ) : undefined,
    version: req.params.version ? `.${sanitizeInt( decodeURIComponent( req.params.version ) )}` : ""
  };
  logger.info(`[wiki] ${userLogDisplay(req)} /markdown/${topic}/${version}`);

  if (!topic) {
    logger.error(`[wiki] ${userLogDisplay(req)} /markdown 400 Missing topic name.`);
    return res.status(400).send("Missing topic name.");
  }

  const filePath = path.join(version == "" ? WIKI_DIR_LATEST : WIKI_DIR_VERSIONED, `${topic}${version}.md`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send("Topic not found.");
  }

  res.sendFile(filePath);
});

// POST ${req.baseUrl}/preview (submit req.body: { content: <markdown> }, get HTML; used for live preview in edit page)
router.post("/preview", guardForProdHostOnly(HOSTNAME_FOR_EDITS), express.json({ limit: '50mb' }), (req, res) => {
  const { content } = req.body; // markdown
  if (!content) {
    logger.error(`[wiki] ${userLogDisplay(req)} /preview 400 Missing content`);
    return res.status(400).send("Missing content.");
  }
  res.send(markdownToHtml(content, `${req.baseUrl}${view_route}`, {
    userdata: USERS_WHITELIST,
  }));
});

const multer = require("multer");

//////////  filestorage utils //////////////////////////////////////////////////
const uploadFile = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      if (!fs.existsSync( WIKI_FILES_DIR ))
        fs.mkdirSync(WIKI_FILES_DIR, { recursive: true });
      cb(null, WIKI_FILES_DIR);
    },
    filename: (req, file, cb) => {
      cb(null, Date.now() + path.extname(file.originalname));
    },
  })
});
// files are mostly static since they cant really be deleted in the wiki
const staticFileMiddleware = express.static(WIKI_FILES_DIR, {
  maxAge: '7d',          // client-side cache duration
  etag: true,            // enable ETag headers
  lastModified: true,    // include Last-Modified header
  setHeaders: (res, path) => {
    // Optional: customize headers further if needed
    res.set('Cache-Control', 'public, max-age=604800'); // 7 days
  }
})

// Static directory to serve uploaded files
router.use( uploads_file_serv_url_prefix, (req, res, next) => {

  // Absolute path to the requested file
  const requestedPath = path.resolve( WIKI_FILES_DIR, sanitize( WIKI_FILES_DIR, req.path ).fullPath );

  // Ensure the resolved path is still inside the WIKI_FILES_DIR
  // no .md files.
  // TODO: use a whitelist maybe...
  if (!requestedPath.startsWith(path.resolve(WIKI_FILES_DIR)) || requestedPath.match( /\.md$/ )) {
    logger.warn(`[wiki] ${userLogDisplay(req)} USE ${uploads_file_serv_url_prefix} ... Attempted path traversal: ${requestedPath}`);
    return res.status(403).send("Forbidden");
  }

  let relativePath = path.relative( WIKI_FILES_DIR, requestedPath);
  req.url = '/' + relativePath;
  logger.info(`[wiki] ${userLogDisplay(req)} USE ${uploads_file_serv_url_prefix}${req.path} url:${req.url}`);
  staticFileMiddleware(req, res, next);
});

// Route to handle file upload)
router.post( "/upload/file", guardForProdHostOnly(HOSTNAME_FOR_EDITS), uploadFile.single("file"), (req, res) => {
  if (req.file) {
    logger.info(`[wiki] ${userLogDisplay(req)} POST /upload/file starting: '${req.file.filename}'`);
    const allowedMimes = [ "application/pdf", "audio/mpeg", "audio/m4a", "audio/mp4", "audio/x-m4a" ];
    if (!allowedMimes.some((type) => type instanceof RegExp ? type.test(req.file.mimetype) : req.file.mimetype === type )) {
      logger.warn(`[wiki] /upload/file rejected: unsupported mimetype ${req.file.mimetype}`);
      return res.status(415).json({ success: false, message: `Unsupported file type: ${req.file.mimetype}` });
    }
    const fileUrl = `${req.baseUrl}${uploads_file_serv_url_prefix}/${req.file.filename}`;
    logger.info(`[wiki] ${userLogDisplay(req)} POST /upload/file finished: '${req.file.filename}', url:${fileUrl}`);
    writeToChangeLog( req, `Uploaded '[${req.file.filename}](${fileUrl})'` );
    return res.json({ success: true, fileUrl });
  } else {
    logger.warn(`[wiki] ${userLogDisplay(req)} POST /upload/file ... No file uploaded`);
    return res.status(400).json({ success: false, message: "No file uploaded." });
  }
});



//////////  image storage utils ////////////////////////////////////////////////
// Set up multer for image uploads
const uploadImage = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      if (!fs.existsSync( WIKI_DIR ))
        fs.mkdirSync(WIKI_DIR, { recursive: true });
      cb(null, WIKI_DIR);
    },
    filename: (req, file, cb) => {
      // Use the original file name, or a unique one based on the current time
      cb(null, Date.now() + path.extname(file.originalname));
    }
  })
});
// images are mostly static since they cant really be deleted in the wiki
const staticMiddleware = express.static(WIKI_DIR, {
  maxAge: '7d',          // client-side cache duration
  etag: true,            // enable ETag headers
  lastModified: true,    // include Last-Modified header
  setHeaders: (res, path) => {
    // Optional: customize headers further if needed
    res.set('Cache-Control', 'public, max-age=604800'); // 7 days
  }
})

// Static directory to serve uploaded images
router.use(uploads_image_serv_url_prefix, (req, res, next) => {

  // Absolute path to the requested file
  const requestedPath = path.resolve( WIKI_DIR, sanitize( WIKI_DIR, req.path ).fullPath );

  // Ensure the resolved path is still inside the WIKI_DIR
  // no .md files.
  // TODO: use a whitelist maybe...
  if (!requestedPath.startsWith(path.resolve(WIKI_DIR)) || requestedPath.match( /\.md$/ )) {
    logger.warn(`[wiki] ${userLogDisplay(req)} USE ${uploads_image_serv_url_prefix} ... Attempted path traversal: ${requestedPath}`);
    return res.status(403).send("Forbidden");
  }

  let relativePath = path.relative(WIKI_DIR, requestedPath);
  req.url = '/' + relativePath;
  logger.info(`[wiki] ${userLogDisplay(req)} USE ${uploads_image_serv_url_prefix}${req.path} url:${req.url}`);
  staticMiddleware(req, res, next);
});

// Route to handle image upload
router.post( "/upload/image", guardForProdHostOnly(HOSTNAME_FOR_EDITS), uploadImage.single("file"), (req, res) => {
  if (req.file) {
    logger.info(`[wiki] ${userLogDisplay(req)} POST /upload starting: '${req.file.filename}'`);
    const allowedMimes = [ /^image\// ];
    if (!allowedMimes.some(type => type instanceof RegExp ? type.test(req.file.mimetype) : req.file.mimetype === type )) {
      logger.warn(`[wiki] /upload rejected: unsupported mimetype ${req.file.mimetype}`);
      return res.status(415).json({ success: false, message: `Unsupported file type: ${req.file.mimetype}` });
    }
    const fileUrl = `${req.baseUrl}${uploads_image_serv_url_prefix}/${req.file.filename}`;
    logger.info(`[wiki] ${userLogDisplay(req)} POST /upload finished: '${req.file.filename}', url:${fileUrl}`);
    writeToChangeLog( req, `Uploaded '[${req.file.filename}](${fileUrl})'` );
    return res.json({ success: true, fileUrl });
  } else {
    logger.warn(`[wiki] ${userLogDisplay(req)} POST /upload ... No file uploaded`);
    return res.status(400).json({ success: false, message: "No file uploaded." });
  }
});



///////////////////// SEARCH ///////////////////////////////////////////////////

function __buildPageSearch( req, title = "Search", endpoint = "search", description, search_buttons ) {
  // if building for static host (www) while edithost is different, search only lives on edithost, so need to qualify what domain...
  let use_domain = req.prodMode && HOSTNAME_FOR_EDITS != HOSTNAME_FOR_STATIC;
  let optional_domain = (use_domain ? `https://${HOSTNAME_FOR_EDITS}.${DOMAINS[0]}` : "");
  const assets_magic = req.staticMode ? "assets" : ASSETS_MAGIC;

  return template.file( "template.search.html", {
    TITLE: title,
    REQ_BASEURL: req.baseUrl,
    SEARCH_URL: `${optional_domain}${req.baseUrl}/${endpoint}`,
    optional_domain: optional_domain,
    DESCRIPTION: description,
    ADDITIONAL_SEARCH_BUTTONS: search_buttons,
    ASSETS_MAGIC: assets_magic
  });
}

function buildPageSearch( req ) {
  return __buildPageSearch( req,
    "Search",
    "search", //<%=optional_domain%>
    (fs.existsSync(YOUTUBE_TRANSCRIPTS_DIR) && fs.statSync(YOUTUBE_TRANSCRIPTS_DIR).isDirectory()) ? `Or head over to <a href='${req.baseUrl}/search-youtube?searchterm=\${searchterm}'>youtube search</a>` : "",
    JSON.stringify( ADDITIONAL_WIKI_SEARCH_BUTTONS )
  )
}

function buildPageYoutubeSearch( req ) {
  return __buildPageSearch( req,
    "Search (YouTube Transcripts)",
    "search-youtube",//<%=optional_domain%>
    `Keep in mind that YouTube has transcription errors in: words that aren't pronounced clearly, audio dropouts, and especially non-english words (obliterated typically, misspelled at best)<BR><BR><b>tldr:</b> Dont expect any Greek words to work.<BR>This is a critical problem with YouTube's auto transcription, and why hand transcription is superior.<BR><BR>Or head over to <a href='${req.baseUrl}/search?searchterm=\${searchterm}'>wiki search</a>`,
    JSON.stringify( ADDITIONAL_YOUTUBE_SEARCH_BUTTONS )
  )
}

// GET /search: Serve the search page
router.get('/search', (req, res) => {
  //const searchTerm = req.body.searchTerm ? req.body.searchTerm.toLowerCase() : "";
  logger.info( `[wiki] ${userLogDisplay(req)} ${req.baseUrl}/search`)

  res.send( buildPageSearch( req ) )
});

// GET /search-youtube: Serve the search page
router.get('/search-youtube', (req, res) => {
  //const searchTerm = req.body.searchTerm ? req.body.searchTerm.toLowerCase() : "";
  logger.info( `[wiki] ${userLogDisplay(req)} ${req.baseUrl}/search-youtube`)

  res.send( buildPageYoutubeSearch( req ) )
});

// PUT /search: Handle the search request
// {
//   method: 'PUT',
//   headers: { 'Content-Type': 'application/json' },
//   body: JSON.stringify({ searchTerm })
// }
router.put('/search', express.json(), (req, res) => {
  try {
    const searchTerm = req.body.searchTerm ? req.body.searchTerm.toLowerCase() : "";
    if (searchTerm == "") return res.json([]);

    const queryWords = searchTerm.split(',').filter(Boolean);
    const hasUsableTerms = queryWords.some(term => term.trim().length > 0);
    if (!hasUsableTerms) return res.json([]);

    // Read all markdown files in the directory
    let results = []
    fs.readdirSync(WIKI_DIR).filter( file => regex_match_fullversion_md.test(file) ).forEach(file => {
      if (file.match(/^ChangeLog.md$/)) return; // skip this special log file

      const filePath = path.join(WIKI_DIR, file);
      const topic = path.basename(file, '.md');
      const content = fs.readFileSync(filePath, 'utf8').toLowerCase();
      let score = 0;
      /*
      let content_matches = topic.match(new RegExp(`.{0,10}${searchTerm}.{0,10}`, 'gi')) || [];
      if (0 < content_matches.length) {
        score += 10 * content_matches.length;
        context += `<ul><li>Title "${topic.replace(new RegExp(`(${searchTerm})`, 'gi'),'<b>$1</b>')}</b>" includes the name</li></ul>`
      }
      content_matches = content.match(new RegExp(`^#{1,6} .*${searchTerm}.*$`, 'gm')) || [];
      if (0 < content_matches.length) {
        score += 4 * content_matches.length;
        context += `<ul>`+content_matches.map( r=>`<li>Heading: ${r.replace(new RegExp(`(${searchTerm})`),'<b>$1</b>')}`).join( "<BR>" )+`</ul>`
      }
      content_matches = content.match(new RegExp(`.{0,10}${searchTerm}.{0,10}`, 'gi')) || [];
      if (0 < content_matches.length) {
        score += 1 * content_matches.length;
        context += `<ul>`+content_matches.filter(r => undefined == r.match( /^#{1,6} .*?$/ )).map( r=>`<li>Body: ...${r.replace(new RegExp(`(${searchTerm})`),'<b>$1</b>')}...`).join( "<BR>" )+`</ul>`
      }
      */
      const titleMatches = [];
      const headingMatches = [];
      const bodyMatches = [];

      queryWords.forEach(rawTerm => {
        const term = rawTerm.trim();
        if (!term) return;
        const escapedTerm = escapeRegex(term);
        const highlightRegex = new RegExp(`(${escapedTerm})`, 'gi');

        let content_matches = topic.match(new RegExp(`.{0,10}${escapedTerm}.{0,10}`, 'gi')) || [];
        if (0 < content_matches.length) {
          score += 10 * content_matches.length;
          titleMatches.push(`<li>Title "${topic.replace(highlightRegex,'<b>$1</b>')}" includes "${term}"</li>`);
        }

        content_matches = content.match(new RegExp(`^#{1,6} .*${escapedTerm}.*$`, 'gm')) || [];
        if (0 < content_matches.length) {
          score += 4 * content_matches.length;
          headingMatches.push(...content_matches.map(r => `<li>Heading: ${r.replace(highlightRegex,'<b>$1</b>')}`));
        }

        content_matches = content.match(new RegExp(`.{0,10}${escapedTerm}.{0,10}`, 'gi')) || [];
        if (0 < content_matches.length) {
          score += 1 * content_matches.length;
          bodyMatches.push(...content_matches
            .filter(r => undefined == r.match( /^#{1,6} .*?$/ ))
            .map(r => `<li>Body: ...${r.replace(highlightRegex,'<b>$1</b>')}...`));
        }
      });

      let context = "";
      if (titleMatches.length) context += `<ul>${titleMatches.join("")}</ul>`;
      if (headingMatches.length) context += `<ul>${headingMatches.join("<BR>")}</ul>`;
      if (bodyMatches.length) context += `<ul>${bodyMatches.join("<BR>")}</ul>`;

      // Only add to results if there's a score
      if (score > 0) {
        results.push({ topic, score, title: `${topic}`, link: `${req.baseUrl}${view_route}/${topic}?searchterm=${searchTerm}`, body: `${context}` });
      }
    });

    // Sort results by score in descending order
    results.sort((a, b) => b.score - a.score);

    logger.info( `[search] ${userLogDisplay(req)} "${searchTerm}" ${results.length} results (topics)` )
    // Return the results
    res.json(results);
  } catch (error) {
    logger.error( `ERROR ${error}` )
    return res.json([]);
  }
});


// youtube subtitles directory: with .json subtitle files
const subsCache = new Map();

/**
 * PUT /search-youtube
 * {
 *   method: 'PUT',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({ searchTerm })
 * }
 */
router.put('/search-youtube', express.json(), async (req, res) => {
  try {
    const searchTerm = req.body.searchTerm ? req.body.searchTerm.toLowerCase() : "";
    if (searchTerm === "") return res.json([]);

    const files = await fs.promises.readdir(YOUTUBE_TRANSCRIPTS_DIR);

    const queryWords = searchTerm.split(',').filter(Boolean); // multiple terms if commas are used, otherwise single unsplit term
    //const queryWords = [ searchTerm ]; // no splitting, one term only.

    // parallel
    const filePromises = files
      .filter(file => file.endsWith('.json'))
      .map(async file => {
        let subtitles;

        if (subsCache.has(file)) {
          subtitles = subsCache.get(file);
        } else {
          const fileData = await fs.promises.readFile(path.join(YOUTUBE_TRANSCRIPTS_DIR, file), 'utf8');
          subtitles = JSON.parse(fileData);
          subsCache.set(file, subtitles);
        }

        // count the matches in that one file's subtitles...
        const matches = subtitles
          .map(sub => {
            const text = sub.text.toLowerCase();
            let found_words = {}
            for (const word of queryWords) {
              if (text.includes(word)) {
                found_words[word] = found_words[word] ? (found_words[word] + 1) : 1;
              }
            }
            let matchCount = Object.values(found_words).reduce((a, b) => a + b, 0);
            //let uniqueCount = Object.values(found_words).reduce((a, b) => (a>0?1:0) + (b>0?1:0), 0);
            if (matchCount > 0) {
              // highlight
              let highlighted = sub.text;
              for (const word of queryWords) {
                const re = new RegExp(`(${word})`, "ig");
                highlighted = highlighted.replace(re, "<b>$1</b>");
              }
              return {
                start: sub.start,
                end: sub.end,
                text: highlighted,
                found_words,
                //matchCount,
                //uniqueCount,
              };
            }
            return null;
          })
          .filter(Boolean);

        if (matches.length > 0) {
          //const fileScore = matches.reduce((acc, cur) => acc + (cur.matchCount*1) + (cur.uniqueCount*5) - ((queryWords - cur.uniqueCount) * 100), 0);
          const fileStats = matches.reduce((acc, cur) => {
            for (const [word, count] of Object.entries(cur.found_words)) {
              acc.found_words[word] = (acc.found_words[word] || 0) + count;
            }
            return acc;
          }, { found_words: {} });
          let matchCount = Object.values(fileStats.found_words).reduce((a, b) => a + b, 0);
          let uniqueCount = Object.values(fileStats.found_words).reduce((a, b) => (a>0?1:0) + (b>0?1:0), 0);
          const fileScore = (matchCount*1) + (uniqueCount*5) - ((queryWords.length - uniqueCount) * 100);
          //console.log( file, fileScore )

          function srtTimestampToSeconds(timestamp) {
            // expects format HH:MM:SS,mmm
            const parts = timestamp.split(/[:,]/); // split on colon and comma
            if (parts.length !== 4) return 0; // fallback
            
            const [hours, minutes, seconds, millis] = parts.map(Number);
            return hours * 3600 + minutes * 60 + seconds;
          }
          function linkifyTimestamps(textLine, videoId) {
            const timestampRegex = /(\d{2}:\d{2}:\d{2},\d{3})/g;
          
            return textLine.replace(timestampRegex, (match) => {
              const seconds = srtTimestampToSeconds(match);
              return `<a href="https://youtu.be/${videoId}?t=${seconds}">${match}</a>`;
            });
          }

          // parse video ID from filename
          //console.log( file )
          const idMatch = file.match(/^(.+)-([-\w]{11})\.([a-z][a-z])\.srt\.json$/);
          const title = idMatch ? idMatch[1] : null;
          const videoId = idMatch ? idMatch[2] : null;
          const videoUrl = videoId ? `https://youtu.be/${videoId}` : null;

          // format lines
          const lines = matches.map(m => {
            return `  <li>${linkifyTimestamps( m.start, videoId )} → ${linkifyTimestamps( m.end, videoId )} - ${m.text}`;
          });

          // results.push({ topic, score, title: `${topic}`, link: `${req.baseUrl}${view_route}/${topic}?searchterm=${searchTerm}`, body: `${context}` });
          if (title == null || title == "null") {
            console.log( `null: file:"${file}" matches:${idMatch ? idMatch.length : 0} ${JSON.stringify( idMatch )}`, )
          }
          return {
            topic: "youtube",
            title: `${title} (score:${fileScore} hits:${matchCount})`,
            link: videoUrl,
            score: fileScore,
            body: '<ul>\n' + lines.join( "\n") + '\n</ul>'
          };
        } else {
          return null;
        }
      });

    const results = (await Promise.all(filePromises)).filter(Boolean);

    // sort descending by score
    results.sort((a, b) => b.score - a.score);

    logger.info(`[search] ${userLogDisplay(req)} ${JSON.stringify(queryWords)} ${results.length} results (youtube)`);

    res.json(results);

  } catch (err) {
    console.error(err);
    res.status(200).json([]);
  }
});


// Function to generate sitemap entries from wiki files
async function getSitemapEntries( baseUrl = "", endpoint = "/wiki" ) {
  //const currentTime = (new Date()).toISOString().slice(0, 10);
  const fs_async = require( "fs/promises" );
  const files = await fs_async.readdir(WIKI_DIR);

  // Filter markdowns
  const mdFiles = files.filter(file => regex_match_fullversion_md.test(file));

  // For each, grab stats concurrently (efficient, non-blocking)
  let entries = await Promise.all(
    mdFiles.map(async f => {
      const stats = await fs_async.stat(path.join(WIKI_DIR, f));
      return {
        url: `${baseUrl}/${endpoint}${view_route}/${encodeURIComponent( path.basename(f, ".md") )}`,
        lastmod: stats.mtime.toISOString().split('.')[0] + 'Z', // last modified
        priority: 0.5,
        changefreq: "daily",
      };
    })
  );

  // add / or index
  try {
    const stats = await fs_async.stat(path.join(WIKI_DIR, "index.md"));
    entries = [
    {
      url: `${baseUrl}`,
      lastmod: stats.mtime.toISOString().split('.')[0] + 'Z', // last modified
      priority: 1.0,
      changefreq: "daily",
    },
    // {
    //   url: `${baseUrl}/${endpoint}${view_route}`,
    //   lastmod: stats.mtime.toISOString().split('.')[0] + 'Z', // last modified
    //   priority: 1.0,
    //   changefreq: "daily",
    // },
    ...entries]
  } catch (err) {
    // index.md doesn't have to exist, ok to fail. (we do expect it to exist though, since it's the root landing page)
    logger.error( "[sitemap.xml] index.md doesn't exist??  weird.   someone should setup their wiki!")
    logger.error( `${err.stack}` )
  }

  return entries;
}


////////////////////////////////////////////////////////////////////////////////

function runTests() {
  function test_sanitizeTopic( p, expected_result ) {
    let pp = sanitizeTopic( p );
    if (expected_result != pp) {
      let msg = `['${p}', '${expected_result}']  expected '${expected_result}', got '${pp}'`;
      logger.error(`[auto test] : ${msg}`);
      throw `unexpected result in test_sanitizeTopic ${msg}`
    }
  }
  test_sanitizeTopic( "../Hello_World - 123!@#Γεια_σου-🌍", "Hello_World - 123Γεια_σου-" );
}
function init( l ) {
  logger = l;

  runTests();
  template.init( l );
  sanitizer.init( l, ALLOW_DOTFILES );
}

// Plug into Express
module.exports.router = router;
module.exports.init = init;
module.exports.getSitemapEntries = getSitemapEntries;
module.exports.buildPageSearch = buildPageSearch;
module.exports.buildPageYoutubeSearch = buildPageYoutubeSearch;
