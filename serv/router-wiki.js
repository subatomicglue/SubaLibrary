const fs = require("fs");
const path = require("path");
const express = require("express");
const router = express.Router();
const sanitizer = require('./sanitizer');
const sanitize = sanitizer.sanitize;
const template = require('./template');
const { markdownToHtml, htmlToMarkdown } = require('./markdown')
const { init: markdownTests } = require('./markdown-tests')
markdownTests();
const { guardOnlyAllowHost } = require("./router-auth");

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
  USER_ANON_DISPLAY,
  HOSTNAME_FOR_EDITS,
  WIKI_CHANGELOG_TOPICNAME,
} = require('./settings');

let logger;

// routes (must end in /)
const view_route="/view"
const edit_route="/edit"
const diff_route="/diff"

function writeToChangeLog( req, line_without_newline ) {
  const filepath = path.resolve( path.join( WIKI_DIR, WIKI_CHANGELOG_TOPICNAME + ".md" ) )
  const utcTimestamp = new Date();
  const utcYear = utcTimestamp.getFullYear();
  const utcMonth = String(utcTimestamp.getMonth() + 1).padStart(2, '0');
  const utcDay = String(utcTimestamp.getDate()).padStart(2, '0');
  const utcHours = String(utcTimestamp.getHours()).padStart(2, '0');
  const utcMinutes = String(utcTimestamp.getMinutes()).padStart(2, '0');
  const utcSeconds = String(utcTimestamp.getSeconds()).padStart(2, '0');
  const formattedLocalDate = `${utcYear}-${utcMonth}-${utcDay} ${utcHours}:${utcMinutes}:${utcSeconds}`;
  let contents = fs.existsSync( filepath ) ? fs.readFileSync( filepath, 'utf8' ) : "";
  contents = `[${formattedLocalDate}] [${req.user}](WikiUser-${req.user}) : ${line_without_newline}\n` + contents;
  fs.writeFileSync( filepath, contents, 'utf8' );
}

// Ensure wiki directory exists
if (!fs.existsSync(WIKI_DIR)) {
    fs.mkdirSync(WIKI_DIR, { recursive: true });
}

function isLoggedIn( req ) {
  return !(req.user == undefined || req.user == USER_ANON_DISPLAY)
}


function userLogDisplay(req_user, req_ip) {
  return `[${req_user!=""?`${req_user}@`:""}${req_ip.replace(/^::ffff:/, '')}]`
}

function wrapWithFrame(content, topic, req, t=new Date()) {
  let autoscroll = `<script>
    function scrollToFirstMark() {
      const firstMark = document.querySelector('mark');
      if (firstMark)
        firstMark.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    function searchTerm() {
      const url = new URL(window.location.href);
      const params = new URLSearchParams(url.search);
      if (params.has('searchterm'))
        return params.get('searchterm'); // Get the value of the searchterm
      return false;
    }
    if (searchTerm())
      document.addEventListener('DOMContentLoaded', scrollToFirstMark);
    </script>
  `
  return template.file( "template.page.html", {
    ...require('./settings'), ...{ CANONICAL_URL: req.canonicalUrl, CANONICAL_URL_ROOT: req.canonicalUrlRoot, CANONICAL_URL_DOMAIN: req.canonicalUrlDomain, CURRENT_DATETIME: t.toISOString().replace(/\.\d{3}Z$/, '+0000') },
    TITLE: `${TITLE}`,
    SOCIAL_TITLE: `${TITLE}${(topic != "index") ? ` - ${topic}` : ""}`,
    ASSETS_MAGIC,
    BACKBUTTON_PATH: `/`,
    BACKBUTTON_VISIBILITY: `visible`,//`hidden`,
    BACKBUTTON_IMAGE: `/${ASSETS_MAGIC}/home_24dp_E3E3E3_FILL0_wght400_GRAD0_opsz24.svg`,
    PAGE_TITLE: `<a href="${req.baseUrl}${view_route}">/</a>${topic} ${isLoggedIn( req ) ? `(<a href="${req.baseUrl}${edit_route}/${topic}">edit</a>)`:``}`,
    USER: `${req.user}`,
    SCROLL_CLASS: "scroll-child-wiki",
    WHITESPACE: "normal",
    BODY: `${autoscroll}<div style="max-width: 60rem; margin-left: auto; margin-right: auto; padding-left: 2em;padding-right: 2em;padding-top: 1em;padding-bottom: 1em;">${content}</div>`,
    USER_LOGOUT: (!isLoggedIn( req )) ? `<a style="color: grey;" href="/login">&nbsp;signin</a>` : `<a style="color: grey;" href="/logout">&nbsp;${req.user}&nbsp;signout</a>`,
    SEARCH: `<a href="${req.baseUrl}/search"><img src="/${ASSETS_MAGIC}/search_24dp_E3E3E3_FILL0_wght400_GRAD0_opsz24.svg"/></a>`
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

function sanitizeTopic( topic ) {
  return topic.replace( /[^\p{L}0-9 \-_]/ug, '' ).substring(0, 255) // << this is a whitelist, any chars NOT in this whitelist WILL be removed
}

function sanitizeInt( n ) {
  return parseInt(n) ? parseInt(n) : 0
}

function sanitizeFloat( n ) {
  return parseFloat(n) ? parseFloat(n) : 0.0
}


////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// endpoints
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// general guard, filter anything unexpected or unsupported by the app
router.use((req, res, next) => {
  const req_path = decodeURIComponent( req.path )
  //logger.warn(`[wiki guard] ${userLogDisplay(req.user, req.ip)} : base:${req.baseUrl} path:${req_path} - TODO set up the guards!`);

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

// VIEW
// GET ${req.baseUrl}${view_route}/:topic?/:version?  (get the page view as HTML)
router.get(`${view_route}/:topic?/:version?`, (req, res) => {
  //logger.info(`[wiki] ${userLogDisplay(req.user, req.ip)} RAW from the URL | topic:${req.params.topic} version:${req.params.version}`);
  const { topic, version, searchterm/*, diff*/ } = {
    topic: sanitizeTopic( decodeURIComponent( req.params.topic ? `${req.params.topic}` : "index" ) ),  // Default to index if no topic provided
    version: req.params.version ? `.${sanitizeInt( decodeURIComponent( req.params.version ) )}` : "", // Default to empty string if no version provided
    searchterm: req.query.searchterm ? req.query.searchterm : "",
    // diff: req.query.diff ? `.${sanitizeInt( decodeURIComponent( req.query.diff ) )}` : "",
  };
  //${diff!=""?` diff:${diff}`:``}
  logger.info(`[wiki] ${userLogDisplay(req.user, req.ip)} ${view_route}/${topic}${version != "" ?`/${version}`:''}${searchterm!=""?` searchterm:${searchterm}`:``}`);

  const filePath = sanitize( WIKI_DIR, `${topic}${version}.md`).fullPath
  if (filePath == "") {
    logger.error(`[wiki] ${userLogDisplay(req.user, req.ip)} ${view_route}/ 403 Forbidden '${topic}'`);
    return res.status(403).send(`Forbidden`);
  }
  if (!fs.existsSync(filePath)) {
    logger.info(`[wiki] ${userLogDisplay(req.user, req.ip)} ${view_route}/${topic}${version != "" ?`/${version}`:''} NOT FOUND: ${topic}${version}.md`);
    //return res.status(404).send("Topic not found.");
    const editUrl = `${req.baseUrl}${edit_route}/${topic}`;
    return res.send(`
      <p>Topic "${topic}" not found.</p>
      ${isLoggedIn( req ) ? `<p><a href="${editUrl}">Click here</a> to create or edit this topic.</p>` : `<a href="${req.get('Referer')}">Go Back...</a>`}
    `);
  }

  let markdown = fs.readFileSync(filePath, "utf8");
  if (searchterm != "") {
    markdown = markdown.replace( new RegExp( `(${searchterm})`, 'gim' ), "<mark>$1</mark>" )
  }
  // if (diff != "" && version != "") {
  //   const filePath_older = sanitize( WIKI_DIR, `${topic}${diff}.md`).fullPath
  //   let markdown_older = fs.readFileSync(filePath_older, "utf8");
  //   //markdown = diffLines_toMarkdown( markdown_older, markdown )
  //   let html = diffWords_toHTML( escapeHtml( markdown_older ), escapeHtml( markdown ) )
  //   //markdown = markdown.replace(/^(\+.*)$/gm, "<b>$1</b>").replace(/^(\-.*)$/gm, "<strike>$1</strike>");
  //   // markdown = diffLines_toMarkdown( older, newer );
  //   html = wrapWithFrame(`<p><a href="${req.baseUrl}${view_route}/${topic}/${version.replace(/^\./,'')}">View ${version.replace(/^\./,'')}</a> <a href="${req.baseUrl}${view_route}/${topic}/${diff.replace(/^\./,'')}">View ${diff.replace(/^\./,'')}</a> </p><pre style="border: 1px solid #ccc; background: #f6f6fa; padding: 1em; overflow-x: auto;"><code>`+ html +"</code></pre>", topic, req);
  //   res.send(html);
  // }
  const html = wrapWithFrame(markdownToHtml(markdown, `${req.baseUrl}${view_route}`, {
    // get a direct link to edit page, for any relative (topic) link that doesn't exist yet
    link_relative_callback: (baseUrl, link_topic) => {
      const topic = sanitizeTopic( decodeURIComponent( link_topic ) )
      const filePath = sanitize( WIKI_DIR, `${topic}.md`).fullPath
      return fs.existsSync(filePath) ? `${req.baseUrl}${view_route}/${topic}` : (!fs.existsSync(filePath) && !isLoggedIn( req )) ? '' : `${req.baseUrl}${edit_route}/${topic}`
    },
  }), topic, req);
  res.send(html);
});

// DIFF
// GET ${req.baseUrl}${diff_route}/:topic?/:version_new/:version_old/  (get the page view as HTML)
router.get(`${diff_route}/:topic?/:version_new/:version_old/`, (req, res) => {
  const { topic, version_new, version_old } = {
    topic: sanitizeTopic( decodeURIComponent( req.params.topic ? `${req.params.topic}` : "index" ) ),  // Default to index if no topic provided
    version_new: req.params.version_new ? `.${sanitizeInt( decodeURIComponent( req.params.version_new ) )}` : "", // Default to empty string if no version provided
    version_old: req.params.version_old ? `.${sanitizeInt( decodeURIComponent( req.params.version_old ) )}` : "", // Default to empty string if no version provided
  };
  logger.info(`[wiki] ${userLogDisplay(req.user, req.ip)} ${diff_route}/${topic}${version_new != "" ?`/${version_new}`:''}${version_old!=""?`/${version_old}`:``}`);

  const filePath_new = sanitize( WIKI_DIR, `${topic}${version_new}.md`).fullPath
  const filePath_old = sanitize( WIKI_DIR, `${topic}${version_old}.md`).fullPath
  if (filePath_new == "" || filePath_old == "") {
    logger.error(`[wiki] ${userLogDisplay(req.user, req.ip)} ${diff_route}/ 403 Forbidden${filePath_new == "" ? ` ${topic}.${version_new}`:""}${filePath_old == "" ? ` ${topic}.${version_old}`:""}`);
    return res.status(403).send(`Forbidden`);
  }
  if (!fs.existsSync(filePath_new)) {
    logger.info(`[wiki] ${userLogDisplay(req.user, req.ip)} ${diff_route}/${topic}${version_new != "" ?`/${version_new}`:''} NOT FOUND: ${topic}${version_new}.md`);
    return res.status(404).send( "Not found." );
  }
  if (!fs.existsSync(filePath_old)) {
    logger.info(`[wiki] ${userLogDisplay(req.user, req.ip)} ${diff_route}/${topic}${version_old != "" ?`/${version_old}`:''} NOT FOUND: ${topic}${version_old}.md`);
    return res.status(404).send( "Not found." );
  }

  let markdown_new = fs.readFileSync(filePath_new, "utf8");
  let markdown_old = fs.readFileSync(filePath_old, "utf8");
  //markdown = diffLines_toMarkdown( markdown_older, markdown )
  let html = diffWords_toHTML( escapeHtml( markdown_old ), escapeHtml( markdown_new ) )
  html = wrapWithFrame(`<p><a href="${req.baseUrl}${view_route}/${topic}/${version_new.replace(/^\./,'')}">View ${version_new.replace(/^\./,'')}</a> <a href="${req.baseUrl}${view_route}/${topic}/${version_old.replace(/^\./,'')}">View ${version_old.replace(/^\./,'')}</a> </p><pre style="border: 1px solid #ccc; background: #f6f6fa; padding: 1em; overflow-x: auto;"><code>`+ html +"</code></pre>", topic, req);
  res.send(html);
});

// SAVE
// PUT /save   (write page markdown;  req.body: { topic: "TOPICNAME", content: "Markdown content" })
router.put("/save", guardOnlyAllowHost(HOSTNAME_FOR_EDITS), express.json({ limit: '50mb' }), (req, res) => {
  const { topic, content } = {
    topic: sanitizeTopic( req.body.topic ),
    content: req.body.content,
  }
  if (!topic || !content) {
    logger.error(`[wiki] ${userLogDisplay(req.user, req.ip)} /save 400 Missing topic or content`);
    return res.status(400).send("Missing topic or content.");
  }

  if (topic == "" || sanitizeTopic( topic ) != topic) {
    logger.error(`[wiki] ${userLogDisplay(req.user, req.ip)} /save 403 Forbidden '${topic}'`);
    return res.status(403).send(`Forbidden`);
  }
  if (topic == "ChangeLog") {
    writeToChangeLog( req, `Attempted to Edit '[${topic}](${req.baseUrl}${view_route}/${topic})'` )
    return res.json({ message: "Wiki page did not change.", version: 0 });
  }
  logger.info(`[wiki] ${userLogDisplay(req.user, req.ip)} /save ${topic} content (save)`);

  // Find the next version number
  let existing_versions = readdirSync( WIKI_DIR, new RegExp( `^${topic}\\.?[0-9]*\\.md$` ) );
  let version = existing_versions.length == 0 ? 1 : existing_versions.length;

  // debugging... break out early
  // logger.error(`[wiki] /save Debugging found:${existing_versions.length} next_version:${version} list:${JSON.stringify( existing_versions )}`);
  // return res.status(403).send(`Debugging found:${existing_versions.length} next_version:${version} list:${JSON.stringify( existing_versions )}`);

  const latestFilePath = sanitize( WIKI_DIR, `${topic}.md`).fullPath
  if (latestFilePath == "") {
    logger.error(`[wiki] ${userLogDisplay(req.user, req.ip)} /save 403 Forbidden '${topic}'`);
    return res.status(403).send(`Forbidden`);
  }

  // bail early if the content didn't change
  if (fs.existsSync(latestFilePath)) {
    const latest_file_contents = fs.readFileSync(latestFilePath, "utf8");
    if (content == latest_file_contents) {
      return res.json({ message: "Wiki page did not change.", version: version - 1 });
    }
  }

  const versionedFilePath = sanitize( WIKI_DIR, `${topic}.${version}.md`).fullPath
  if (versionedFilePath == "") {
    logger.error(`[wiki] ${userLogDisplay(req.user, req.ip)} /save 403 Forbidden '${topic}'`);
    return res.status(403).send(`Forbidden`);
  }

  logger.info(`[wiki] ${userLogDisplay(req.user, req.ip)} /save ${topic} ${version} version (save)`);
  fs.writeFileSync(versionedFilePath, content, "utf8");
  fs.writeFileSync(latestFilePath, content, "utf8");
  writeToChangeLog( req, `Edited '[${topic}](${req.baseUrl}${view_route}/${topic})' to [v${version}](${req.baseUrl}${diff_route}/${topic}/${version}${version>1?`/${version-1}#diff`:``})` )
  res.json({ message: "Wiki page updated.", version });
});

// EDIT
// GET ${req.baseUrl}${edit_route}/:topic    (edit page)
router.get(`${edit_route}/:topic`, guardOnlyAllowHost(HOSTNAME_FOR_EDITS), (req, res) => {
  const topic = req.params.topic ? sanitizeTopic( decodeURIComponent( req.params.topic ) ) : undefined;
  if (!topic) {
    logger.error(`[wiki] ${userLogDisplay(req.user, req.ip)} ${edit_route} 400 Missing topic name`);
    return res.status(400).send("Missing topic name.");
  }

  const filePath = sanitize( WIKI_DIR, `${topic}.md` ).fullPath
  if (filePath == "") {
    logger.error(`[wiki] ${userLogDisplay(req.user, req.ip)} ${edit_route} 403 Forbidden '${topic}'`);
    return res.status(403).send(`Forbidden`);
  }

  logger.info(`[wiki] ${userLogDisplay(req.user, req.ip)} ${edit_route} ${topic} ${filePath}`);
  const markdown = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  let t = new Date();
  res.send(template.file( "template.wiki-edit.html", {
      ...require('./settings'), ...{ CANONICAL_URL: req.canonicalUrl, CANONICAL_URL_ROOT: req.canonicalUrlRoot, CANONICAL_URL_DOMAIN: req.canonicalUrlDomain, CURRENT_DATETIME: t.toISOString().replace(/\.\d{3}Z$/, '+0000') },
      TITLE: `${TITLE}`,
      SOCIAL_TITLE: `${TITLE}${(topic != "index") ? ` - ${topic}` : ""}`,
      ASSETS_MAGIC,
      SCROLL_CLASS: "scroll-child-wiki",
      WHITESPACE: "normal",
      USER_LOGOUT: (req.user == undefined || req.user == USER_ANON_DISPLAY) ? `<a style="color: grey;" href="/login">&nbsp;signin</a>` : `<a style="color: grey;" href="/logout">&nbsp;${req.user}&nbsp;signout</a>`,
      req_baseUrl:req.baseUrl,
      topic,
      view_route,
      edit_route,
      description: markdown.length == 0 ? `Reload as <a href="<%=req_baseUrl%><%=edit_route%>2/<%=topic%>">natural</a> &nbsp; &nbsp; &nbsp;` : '',
      // description: markdown.length == 0 ? `For Precise Editing &amp; HTML Paste.   (Reload as <a href="<%=req_baseUrl%><%=edit_route%>2/<%=topic%>">natural</a> for simple/wysiwyg editing)` : '',
      markdown: markdown.replace(/&/g, "&amp;"),
    })
  );
});


// EDIT
// GET ${req.baseUrl}${edit_route}/:topic    (edit page)
router.get(`${edit_route}2/:topic`, guardOnlyAllowHost(HOSTNAME_FOR_EDITS), (req, res) => {
  const topic = req.params.topic ? sanitizeTopic( decodeURIComponent( req.params.topic ) ) : undefined;
  if (!topic) {
    logger.error(`[wiki] ${userLogDisplay(req.user, req.ip)} ${edit_route} 400 Missing topic name`);
    return res.status(400).send("Missing topic name.");
  }

  const filePath = sanitize( WIKI_DIR, `${topic}.md` ).fullPath
  if (filePath == "") {
    logger.error(`[wiki] ${userLogDisplay(req.user, req.ip)} ${edit_route} 403 Forbidden '${topic}'`);
    return res.status(403).send(`Forbidden`);
  }

  logger.info(`[wiki] ${userLogDisplay(req.user, req.ip)} ${edit_route} ${topic} ${filePath}`);
  const markdown = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const html = markdownToHtml( markdown );
  //console.log( html )
  res.send(template.data( `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${TITLE} - Editing ${topic} (natural editor)</title>
  <!-- <link href="https://cdn.quilljs.com/1.3.6/quill.snow.css" rel="stylesheet" /> -->

  <!-- Load Quill 2.0.3 CSS from CDN -->
  <link href="https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.snow.css" rel="stylesheet">
  <style>
    .editor-container, .output-container {
      background-color: #ffffff;
      color: #111111;
      width: 100%;
      box-sizing: border-box;
      padding: 1rem;
    }

    .output-box {
      border: 1px solid #ccc;
      padding: 1rem;
      white-space: pre-wrap;
      word-wrap: break-word;
      background: #f9f9f9;
      overflow-x: auto;
    }

    @media (min-width: 768px) {
      .output-columns {
        display: flex;
        gap: 1rem;
      }
      .output-box {
        flex: 1;
      }
    }

    <%include "style.css"%>

    body {
      background-color: #0D1116;
      color: #aaaaaa;
    }
    .fake-body {
      background-color: #ffffff;
      color: #111111;
    }
    .markdown, .buttons-tray {
      width: 90vw; 
      max-width: 800px; 
      margin: 20px auto; 
      padding: 12px;
    }
    .buttons-tray {
      padding-top:0;
      margin-top:0;
      text-align:right;
    }
    .markdown {
      height: 66vh; /* Cover top 2/3 of the viewport */
      max-height: 500px; /* Prevent it from becoming too tall */
      display: block;
      font-size: 16px;
      border: 1px solid #ccc;
      border-radius: 6px;
      box-shadow: 2px 2px 8px rgba(0, 0, 0, 0.1);
      resize: vertical; /* Allow resizing, but only vertically */
      padding-bottom:0;
      margin-bottom:0;
    }

    @media (max-width: 600px) {
      .markdown {
        width: 95vw; /* Slightly more width on small screens */
        height: 60vh; /* Slightly shorter on mobile */
        font-size: 14px; /* Make text more mobile-friendly */
      }
    }

    .button1, .button2 {
      padding: 0.40em 0.80em;
      font-size: 1.4em;
      font-weight: 600;
      border-radius: 0.50em;
    }

    .button1 {
      border: 1px solid #3f944b;
      background-color: #228736;
      color: #ffffff;
      //color: #9A61F8;
    }

    .button1:hover {
      border: 1px solid #4fa45b;
      background-color: #228736;
      color: #F3F8F3;
    }

    .button1:disabled,
    .button1[disabled]{
      border: 1px solid #3f944b;
      background-color: #228736;
      //color: #F3F8F3;
      color: #8E96a0;
      //color: #9A61F8;
    }

    .button2 {
      border: 1px solid #7E8690;
      background-color: #22282F;
      color: #F3F8F3;
      //color: #9A61F8;
    }

    .button2:hover {
      border: 1px solid #8E96a0;
      background-color: #22282F;
      color: #FFFFFF;
    }

    .button2:disabled,
    .button2[disabled]{
      border: 1px solid #8E96a0;
      background-color: #22282F;
      color: #8E96a0;
      //color: #9A61F8;
    }
  </style>
</head>
<body>
  <h1>Natural Editor: ${topic}</h1>
  For Simple Editing.  (Reload as <a href="${req.baseUrl}${edit_route}/${topic}">markdown</a> for precise editing)<BR>
  CAUTION: Dont nuke the formatting!!! This <i>will</i> DESTROY previous formatting.<BR>
  <!-- Top Section: Quill Editor -->
  <div class="editor-container">
    <div id="toolbar">
      <span class="ql-formats">
        <button class="ql-bold"></button>
        <button class="ql-italic"></button>
        <button class="ql-underline"></button>
        <button class="ql-code"></button>
      </span>
      <span class="ql-formats">
        <select class="ql-header">
          <option selected></option>
          <option value="1"></option>
          <option value="2"></option>
        </select>
      </span>
      <span class="ql-formats">
        <button class="ql-list" value="ordered"></button>
        <button class="ql-list" value="bullet"></button>
        <button class="ql-blockquote"></button>
        <button class="ql-indent" value="-1"></button>
        <button class="ql-indent" value="+1"></button>
      </span>
      <span class="ql-formats">
        <button class="ql-link"></button>
        <!-- <button class="ql-image"></button> -->
      </span>
    </div>
    <div id="editor" style="height: 300px;"></div>
  </div>
  <div class="buttons-tray">
    <!-- Upload button -->
    <input type="file" id="uploadInput" accept="image/*" style="display: none;" />
    <button id="uploadBtn" class="button2" type="file" accept="image/*" >Upload</button>
    <button class="button2" onclick="window.location.href = '${req.baseUrl}/view/${topic}'">Cancel</button>
    <button class="button1" onclick="saveWiki()">Save</button><BR>
  </div>


  <!-- Middle Section: Markdown & HTML Preview -->
  <!-- style="display: none; visibility: hidden" -->
  <div style="display: none; visibility: hidden" class="output-container output-columns">
    <div class="output-box">
      <h3>Markdown Output</h3>
      <div id="markdown-output"></div>
    </div>
    <div class="output-box">
      <h3>HTML Output</h3>
      <div id="html-output"></div>
    </div>
  </div>

  <h2>Preview:</h2>
  <div class="fake-body">
    <div id="html-preview"></div>
  </div>

  <script>
    let module = { exports: {} }
    <%include "markdown.js"%>
  </script>

  <!-- Load Quill 2.0.3 JS from CDN -->
  <!-- <script src="https://cdn.quilljs.com/1.3.6/quill.js"></script> -->
  <script src="https://cdn.jsdelivr.net/npm/quill@2.0.3/dist/quill.min.js"></script>
  <script>
    const quill = new Quill('#editor', {
      theme: 'snow',
      modules: {
        toolbar: '#toolbar'
      }
    });

    const markdownOutput = document.getElementById('markdown-output');
    const htmlOutput = document.getElementById('html-output');

    quill.on('text-change', () => {
      updatePreview()
    });
  </script>

  <script>
    function initFromMarkdown( markdown ) {
      const html = markdownToHtml( markdown, {
        skipYouTubeEmbed: true,
      });
      quill.root.innerHTML = html;
    }
    function initFromHTML( html ) {
      quill.clipboard.dangerouslyPasteHTML(html);
      //quill.root.innerHTML = html;
    }

    function updatePreview() {
      const html = quill.root.innerHTML;
      const markdown = htmlToMarkdown(html);
      markdownOutput.textContent = markdown; // temporary for debug
      htmlOutput.textContent = html;         // temporary for debug

      console.log( html )

      fetch("${req.baseUrl}/preview", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({ content: markdown }) })
        .then(res => res.text())
        .then(html => document.getElementById("html-preview").innerHTML = html);
    }

    function saveWiki() {
      const html = quill.root.innerHTML;
      const markdown = htmlToMarkdown(html);

      fetch("${req.baseUrl}/save", { 
        method: "PUT", 
        headers: {"Content-Type": "application/json"}, 
        body: JSON.stringify({ topic: "${topic}", content: markdown }) 
      })
      .then(res => res.json())
      .then(data => {
        //alert(\`Msg:'\${data.message}' Ver:'\${data.version}'\`);
        document.getElementById("preview").innerHTML = \`<p>Msg:'\${data.message}' Ver:'\${data.version}'\`
        setTimeout( ()=> {
          // Redirect to the view page for the updated topic
          window.location.href = "${req.baseUrl}${view_route}/${topic}";
        }, 1500 );
      });
    }

    // Ensure updatePreview() runs once when the page loads
    document.addEventListener("DOMContentLoaded", () => {
      initFromHTML( \`${html.replace(/`/g,'\\`')}\` )
      updatePreview();

      const dropzone = document.getElementById("editor");
      const uploadBtn = document.getElementById("uploadBtn");
      const uploadInput = document.getElementById("uploadInput");
      console.log( "dropzone", dropzone )

      uploadBtn.addEventListener("click", () => {
        uploadInput.click();
      });

      // handle the file selection
      uploadInput.addEventListener("change", handleFileSelect);

      // Handle image file drop
      dropzone.addEventListener("dragover", (event) => {
          event.preventDefault(); // Prevent default behavior to allow drop
      });

      dropzone.addEventListener("drop", (event) => {
          event.preventDefault();
          const file = event.dataTransfer.files[0]; // Get the first file
          handleFileSelect({ target: { files: [file] } });
      });

      // Function to handle the file selection or drop
      function handleFileSelect(event) {
        console.log( "handleFileSelect" )
        const file = event.target.files[0];
        if (file && file.type.startsWith("image/")) {
            const formData = new FormData();
            formData.append("image", file);
            console.log( "file", file );

            fetch("${req.baseUrl}/upload", {
                method: "POST",
                body: formData,
            })
            .then(response => response.json())
            .then(data => {
                //console.log( "data.success", data.success )
                if (data.success) {
                  setTimeout( () => {
                    console.log( "setting QUILL", data.imageUrl )
                    //quill.root.innerHTML += \`<img src="\${data.imageUrl}" title="an image">\`; // Set image URL into textarea
                    const range = quill.getSelection();

                    setTimeout( () => {
                      updatePreview()
                    }, 400 )
                  }, 400 )
                } else {
                  alert("Failed to upload image.");
                }
            })
            .catch(error => {
              console.error("Error uploading file:", error);
            });
        } else {
          alert("Please upload a valid image.");
        }
      }
    }); // DOMContentLoaded event listener
  </script>
</body>
</html>
    `, {
      SCROLL_CLASS: "scroll-child-wiki",
      WHITESPACE: "normal",
      USER_LOGOUT: (req.user == undefined || req.user == USER_ANON_DISPLAY) ? `<a style="color: grey;" href="/login">&nbsp;signin</a>` : `<a style="color: grey;" href="/logout">&nbsp;${req.user}&nbsp;signout</a>`,
    })
  );
});


// GET /markdown/:topic/:version?   (get the page markdown data)
router.get("/markdown/:topic/:version?", guardOnlyAllowHost(HOSTNAME_FOR_EDITS), (req, res) => {
  const { topic, version } = {
    topic: req.params.topic ? sanitizeTopic( decodeURIComponent( `${req.params.topic}` ) ) : undefined,
    version: req.params.version ? `.${sanitizeInt( decodeURIComponent( req.params.version ) )}` : ""
  };
  logger.info(`[wiki] ${userLogDisplay(req.user, req.ip)} /markdown/${topic}/${version}`);

  if (!topic) {
    logger.error(`[wiki] ${userLogDisplay(req.user, req.ip)} /markdown 400 Missing topic name.`);
    return res.status(400).send("Missing topic name.");
  }

  const filePath = path.join(WIKI_DIR, `${topic}${version}.md`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send("Topic not found.");
  }

  res.sendFile(filePath);
});


// POST ${req.baseUrl}/preview (submit req.body: { content: <markdown> }, get HTML; used for live preview in edit page)
router.post("/preview", guardOnlyAllowHost(HOSTNAME_FOR_EDITS), express.json({ limit: '50mb' }), (req, res) => {
  const { content } = req.body; // markdown
  if (!content) {
    logger.error(`[wiki] ${userLogDisplay(req.user, req.ip)} /preview 400 Missing content`);
    return res.status(400).send("Missing content.");
  }
  res.send(markdownToHtml(content, `${req.baseUrl}${view_route}`));
});

const multer = require("multer");

// Set up multer for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
      // Make sure the 'uploads' directory exists
      const uploadDir = path.join(__dirname, "wiki");
      if (!fs.existsSync(uploadDir)) {
          fs.mkdirSync(uploadDir);
      }
      cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
      // Use the original file name, or a unique one based on the current time
      cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

// Static directory to serve uploaded files
router.use('/uploads', (req, res, next) => {
  logger.info(`[wiki] ${userLogDisplay(req.user, req.ip)} /uploads -> ${req.path}`);

  // Absolute path to the requested file
  const requestedPath = path.resolve( WIKI_DIR, sanitize( WIKI_DIR, req.path ).fullPath );

  // Ensure the resolved path is still inside the WIKI_DIR
  // no .md files.
  // TODO: use a whitelist maybe...
  if (!requestedPath.startsWith(path.resolve(WIKI_DIR)) || requestedPath.match( /\.md$/ )) {
    logger.warn(`Attempted path traversal: ${requestedPath}`);
    return res.status(403).send("Forbidden");
  }

  // Serve it safely
  express.static(WIKI_DIR)(req, res, next);
});

// Route to handle image upload
router.post("/upload", guardOnlyAllowHost(HOSTNAME_FOR_EDITS), upload.single("image"), (req, res) => {
  logger.info(`[wiki] ${userLogDisplay(req.user, req.ip)} /upload`);
  if (req.file) {
    logger.info( `[wiki] ${userLogDisplay(req.user, req.ip)} /upload  file:${req.file}` )
    // Return the URL of the uploaded image
      const imageUrl = `${req.baseUrl}/uploads/${req.file.filename}`;
      writeToChangeLog( req, `Uploaded '[${req.file.filename}](${imageUrl})'` )
      res.json({ success: true, imageUrl: imageUrl });
  } else {
      res.status(400).json({ success: false, message: "No image uploaded." });
  }
});


///////////////////// SEARCH ///////////////////////////////////////////////////

// GET /search: Serve the search page
router.get('/search', (req, res) => {
    const searchTerm = req.body.searchTerm ? req.body.searchTerm.toLowerCase() : "";

    res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Search</title>
            <style>
              /* Basic styling for the search button and input */
              #searchButton {
                cursor: pointer;
                border: none;
                background: none;
                outline: none;
                display: inline-flex;
                align-items: center;
              }

              #searchInput {
                display: none; /* Hidden by default */
                padding: 0.5rem;
                border: 1px solid #ccc;
                border-radius: 4px;
                margin-left: 0.5rem;
              }

              .expanded {
                display: inline-block; /* Show when expanded */
              }
            </style>
        </head>
        <body>
            <h1>Search</h1>
            <form id="searchForm">
                <input type="text" id="searchTerm" name="searchTerm" placeholder="Enter search term" required>
                <button type="submit">Search</button>
            </form>
            <ul id="results"></ul>

            <script>
              function searchTerm() {
                const url = new URL(window.location.href);
                const params = new URLSearchParams(url.search);
                if (params.has('searchterm'))
                  return params.get('searchterm'); // Get the value of the searchterm
                return false;
              }
              const st = searchTerm();
              if (st) document.getElementById('searchTerm').value = st
              document.getElementById('searchForm').onsubmit = async function(event) {
                event.preventDefault();
                const searchTerm = document.getElementById('searchTerm').value;
                console.log( "PUT ${req.baseUrl}/search", {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ searchTerm })
                })
                const response = await fetch('${req.baseUrl}/search', {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ searchTerm })
                });
                const results = await response.json();
                console.log("results:", results)
                const resultsList = document.getElementById('results');
                resultsList.innerHTML = '';
                results.forEach(result => {
                  const li = document.createElement('li');
                  li.innerHTML = \`<a href="\${result.link}">\${result.title}</a>\${result.body}\`;
                  resultsList.appendChild(li);
                });
              };
            </script>
        </body>
        </html>
    `);
});

// PUT /search: Handle the search request
router.put('/search', express.json(), (req, res) => {
  try {
    const searchTerm = req.body.searchTerm ? req.body.searchTerm.toLowerCase() : "";
    if (searchTerm == "") return res.json([]);

    // Read all markdown files in the directory
    let results = []
    fs.readdirSync(WIKI_DIR).filter( file => /^[^.]+\.md$/.test(file) ).forEach(file => {
      const filePath = path.join(WIKI_DIR, file);
      const topic = path.basename(file, '.md');
      const content = fs.readFileSync(filePath, 'utf8').toLowerCase();
      let context = "";
      
      let score = 0;
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

      // Only add to results if there's a score
      if (score > 0) {
        results.push({ topic, score, title: `${topic}`, link: `${req.baseUrl}${view_route}/${topic}?searchterm=${searchTerm}`, body: `${context}` });
      }
    });

    // Sort results by score in descending order
    results.sort((a, b) => b.score - a.score);

    console.log( `[search] ${userLogDisplay(req.user, req.ip)} "${searchTerm}" ${results.length} results` )
    // Return the results
    res.json(results);
  } catch (error) {
    console.log( "ERROR", error )
    return res.json([]);
  }
});


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
