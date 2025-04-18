const fs = require("fs");
const path = require("path");
const express = require("express");
const router = express.Router();
const sanitizer = require('./sanitizer');
const sanitize = sanitizer.sanitize;
const template = require('./template');
const { markdownToHtml } = require('./markdown')
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
  HOSTNAME_FOR_EDITS
} = require('./settings');

let logger;

// routes (must end in /)
const view_route="/view"
const edit_route="/edit"

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

function wrapWithFrame(content, topic, req) {
  return template.file( "page.template.html", {
    ...require('./settings'), ...{ CANONICAL_URL: req.canonicalUrl, CANONICAL_URL_ROOT: req.canonicalUrlRoot, CANONICAL_URL_DOMAIN: req.canonicalUrlDomain, CURRENT_DATETIME: (new Date()).toISOString().replace(/\.\d{3}Z$/, '+0000') },
    TITLE: `${TITLE}`,
    SOCIAL_TITLE: `${TITLE} - ${topic}`,
    ASSETS_MAGIC,
    BACKBUTTON_PATH: `/`,
    BACKBUTTON_VISIBILITY: `visible`,//`hidden`,
    BACKBUTTON_IMAGE: `/${ASSETS_MAGIC}/home_24dp_E3E3E3_FILL0_wght400_GRAD0_opsz24.svg`,
    PAGE_TITLE: `<a href="${req.baseUrl}${view_route}">/</a>${topic} ${isLoggedIn( req ) ? `(<a href="${req.baseUrl}${edit_route}/${topic}">edit</a>)`:``}`,
    USER: `${req.user}`,
    SCROLL_CLASS: "scroll-child-wiki",
    WHITESPACE: "normal",
    BODY: `<div style="padding-left: 2em;padding-right: 2em;padding-top: 1em;padding-bottom: 1em;">${content}</div>`,
    USER_LOGOUT: (!isLoggedIn( req )) ? `<a style="color: grey;" href="/login">&nbsp;signin</a>` : `<a style="color: grey;" href="/logout">&nbsp;${req.user}&nbsp;signout</a>`,
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

// VIEW
// GET ${req.baseUrl}${view_route}/:topic?/:version?  (get the page view as HTML)
router.get(`${view_route}/:topic?/:version?`, (req, res) => {
  //logger.info(`[wiki] ${userLogDisplay(req.user, req.ip)} RAW from the URL | topic:${req.params.topic} version:${req.params.version}`);
  const { topic, version } = {
    topic: sanitizeTopic( decodeURIComponent( req.params.topic ? `${req.params.topic}` : "index" ) ),  // Default to index if no topic provided
    version: req.params.version ? `.${sanitizeInt( decodeURIComponent( req.params.version ) )}` : "" // Default to empty string if no version provided
  };
  logger.info(`[wiki] ${userLogDisplay(req.user, req.ip)} ${view_route}/${topic}${version != "" ?`/${version}`:''}`);

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

  const markdown = fs.readFileSync(filePath, "utf8");
  const html = wrapWithFrame(markdownToHtml(markdown, `${req.baseUrl}${view_route}`, {
    // get a direct link to edit page, for any relative (topic) link that doesn't exist yet
    link_relative_callback: (baseUrl, link_topic) => {
      const topic = sanitizeTopic( decodeURIComponent( link_topic ) )
      const filePath = sanitize( WIKI_DIR, `${topic}.md`).fullPath
      return fs.existsSync(filePath) ? `${req.baseUrl}${view_route}/${topic}` : (!fs.existsSync(filePath) && !isLoggedIn( req )) ? '' : `${req.baseUrl}${edit_route}/${topic}`
    }
  }), topic, req);
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

  const versionedFilePath = sanitize( WIKI_DIR, `${topic}.${version}.md`).fullPath
  if (versionedFilePath == "") {
    logger.error(`[wiki] ${userLogDisplay(req.user, req.ip)} /save 403 Forbidden '${topic}'`);
    return res.status(403).send(`Forbidden`);
  }

  logger.info(`[wiki] ${userLogDisplay(req.user, req.ip)} /save ${topic} ${version} version (save)`);
  fs.writeFileSync(versionedFilePath, content, "utf8");
  fs.writeFileSync(latestFilePath, content, "utf8");
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
  res.send(template.data( `
    <html>
    <head>
      <title>${TITLE} - Editing ${topic} (markdown editor)</title>
      <script>
        function updatePreview() {
          let markdown = document.getElementById("markdown").value;
          fetch("${req.baseUrl}/preview", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({ content: markdown }) })
          .then(res => res.text())
          .then(html => document.getElementById("preview").innerHTML = html);
        }

        function saveWiki() {
          let markdown = document.getElementById("markdown").value;
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
        document.addEventListener("DOMContentLoaded", async () => {
          updatePreview();

          const dropzone = document.getElementById("markdown");
          const uploadBtn = document.getElementById("uploadBtn");
          const textarea = document.getElementById("markdown");
          const uploadInput = document.getElementById("uploadInput");

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

          // Function to handle image uploads (used by paste and file input)
          async function handleImageUpload(file) {
            if (!file || !file.type.startsWith("image/")) {
              alert("Please upload a valid image.");
              return null;
            }

            const formData = new FormData();
            formData.append("image", file);

            try {
              const response = await fetch("${req.baseUrl}/upload", {
                method: "POST",
                body: formData,
              });

              const data = await response.json();

              if (data.success) {
                return data.imageUrl; // Return URL for use by caller
              } else {
                alert("Failed to upload image.");
                return null;
              }
            } catch (error) {
              console.error("Error uploading file:", error);
              return null;
            }
          }

          // Original function, now using handleImageUpload
          function handleFileSelect(event) {
            console.log("handleFileSelect");
            const file = event.target.files[0];

            handleImageUpload(file).then((imageUrl) => {
              if (imageUrl) {
                setTimeout(() => {
                  textarea.value += \`![an image](\${imageUrl})\`;
                  setTimeout(() => {
                    updatePreview();
                  }, 400);
                }, 400);
              }
            });
          }

          let module = { exports: {} }
          <%include "markdown.js"%>

          textarea.addEventListener("paste", async (event) => {
            event.preventDefault();

            console.log( "paste" )

            // Get clipboard data
            const clipboardData = event.clipboardData || window.clipboardData;

            // files / images.
            if (clipboardData.files && clipboardData.files.length > 0) {
              for (const file of clipboardData.files) {
                if (file.type.startsWith("image/")) {
                  console.log("Pasted image file:", file);

                  // TODO: Replace this with your actual image upload logic
                  const imageUrl = await handleImageUpload(file); // Returns a URL after upload

                  if (imageUrl) {
                    const markdown = \`![pasted image](\${imageUrl})\`;
                    insertMarkdown(markdown)
                  }
                }
              }
              return;
            }

            // HTML
            const html = clipboardData.getData("text/html");
            const plainText = clipboardData.getData("text/plain");
            if (clipboardData.types.includes("text/html")) {
              console.log( html ) // debug DEBUG!
              const markdown = htmlToMarkdown(html);
              insertMarkdown(markdown);
            } else if (clipboardData.types.includes("text/plain")) {
              const markdown = plainText;
              insertMarkdown(markdown);
            } else {
              console.log("Unsupported Clipboard type(s) pasted:", clipboardData.types);
            }

            function insertMarkdown(markdown) {
              const selectionStart = textarea.selectionStart;
              const selectionEnd = textarea.selectionEnd;
              const textBefore = textarea.value.substring(0, selectionStart);
              const textAfter = textarea.value.substring(selectionEnd);

              textarea.value = textBefore + markdown + textAfter;
              textarea.selectionStart = textarea.selectionEnd = selectionStart + markdown.length;
            }
          });
        });
      </script>
      <style>
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
      <h1>Markdown Editor: ${topic}</h1>
      ${markdown.length == 0 ? `For Precise Editing &amp; HTML Paste.   (Reload as <a href="${req.baseUrl}${edit_route}2/${topic}">natural</a> for simple/wysiwyg editing)` : ''}
      <textarea id="markdown" class="markdown" onkeyup="updatePreview()" rows="10" cols="50">${markdown.replace(/&/g, "&amp;")}</textarea>
      <div class="buttons-tray">
      <!-- Upload button -->
        <input type="file" id="uploadInput" accept="image/*" style="display: none;" />
        <button id="uploadBtn" class="button2" type="file" accept="image/*" >Upload</button>
        <button class="button2" onclick="window.location.href = '${req.baseUrl}/view/${topic}'">Cancel</button>
        <button class="button1" onclick="saveWiki()">Save</button><BR>
      </div>
      <h2>Preview:</h2>
      <div class="fake-body">
        <div id="preview"></div>
      </div>
    </body>
    </html>
    `, {
      SCROLL_CLASS: "scroll-child-wiki",
      WHITESPACE: "normal",
      USER_LOGOUT: (req.user == undefined || req.user == USER_ANON_DISPLAY) ? `<a style="color: grey;" href="/login">&nbsp;signin</a>` : `<a style="color: grey;" href="/logout">&nbsp;${req.user}&nbsp;signout</a>`,
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
  console.log( html )
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
      const html = markdownToHtml( markdown );
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
      res.json({ success: true, imageUrl: imageUrl });
  } else {
      res.status(400).json({ success: false, message: "No image uploaded." });
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

