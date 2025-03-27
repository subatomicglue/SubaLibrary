const fs = require("fs");
const path = require("path");
const express = require("express");
const router = express.Router();
const sanitizer = require('./sanitizer');
const sanitize = sanitizer.sanitize;
const template = require('./template');
// const marked = require('marked');
// marked.use({
//   //async: true,
//   pedantic: false,
//   gfm: true,
// });
const { markdownToHtml } = require('./markdown')

const {
  TITLE,
  PORT_DEFAULT,
  PUBLIC_DIR,
  LOGS_DIR,
  ASSETS_DIR,
  ALLOWED_EXTENSIONS,
  RATE_LIMIT_WINDOW_SECS,
  RATE_LIMIT_WINDOW_MAX_REQUESTS,
  MAX_PATH_LENGTH,
  USE_HTTPS,
  HTTPS_CERT_CRT,
  HTTPS_CERT_CSR,
  HTTPS_CERT_KEY,
  ALLOW_DOTFILES,
  VERBOSE,
  USERS_WHITELIST,
  SECRET_PASSCODE,
  PORT,
  ASSETS_MAGIC,
  isPM2,
  WIKI_DIR,
} = require('./settings');

let logger;

// routes (must end in /)
const view_route="/view"
const edit_route="/edit"


//// Override link rendering to encode "/localserver" vs "wikipage" vs "https://absolute" 
// const renderer = new marked.Renderer();
// renderer.link = function ({href, title, text}) {
//   console.log( href, title, text )
//   const encodedHref = encodeURI(href); // Encodes spaces to %20
//   const titleAttr = title ? ` title="${title}"` : "";
//   return `<a href="${encodedHref}"${titleAttr}>${text}</a>`;
// };

// renderer.list = function ({ ordered, start, items, listType }) {
//   if (!ordered) {
//       return `<ul>\n${items.map(item => `<li>${item.text}</li>`).join("\n")}\n</ul>\n`;
//   }

//   const typeAttr = listType ? ` type="${listType}"` : "";
//   const startAttr = start ? ` start="${start}"` : "";

//   return `<ol${typeAttr}${startAttr}>\n${items.map(item => `<li>${item.text}</li>`).join("\n")}\n</ol>\n`;
// };

// // ✅ Override list item rendering (unchanged)
// renderer.listitem = function (text) {
//   return `<li>${text}</li>\n`;
// };

// // Define allowed ordered list formats
// const orderedListTypes = {
//   number: /^\d+\.$/,   // 1., 2., 3.
//   lowerAlpha: /^[a-z]\.$/, // a., b., c.
//   upperAlpha: /^[A-Z]\.$/, // A., B., C.
//   lowerRoman: /^[ivx]+\.$/, // i., ii., iii.
//   upperRoman: /^[IVX]+\.$/ // I., II., III.
// };

// // Create a custom tokenizer to fix/allow links with spaces
// const tokenizer = {
//   link(src) {
//     const match = src.match(/\[([^\]]+)\]\(([^)]+)\)/);
//     if (match) {
//       return {
//         type: "link",
//         raw: match[0],
//         text: match[1],
//         href: encodeURI(match[2].trim()), // Encode spaces in URLs
//         tokens: marked.lexer(match[1]) // Parse inner text as Markdown
//       };
//     }
//     return false; // Fallback to default behavior
//   },
//   list(src) {
//     const lines = src.split("\n"); // Split the input into lines
//     let items = [];
//     let listType = "1"; // Default numeric list
//     let startNumber;
//     let indentStack = []; // Stack to track indentation levels
//     let lastIndent = 0;

//     for (let line of lines) {
//         const match = line.match(/^(\s*)([a-zA-Z0-9ivxIVX]+)\.\s+(.*)/);
//         if (!match) continue;

//         const [raw, indent, marker, text] = match;
//         const currentIndent = indent.length;

//         // Detect list type from marker
//         if (orderedListTypes.lowerAlpha.test(marker)) listType = "a";
//         else if (orderedListTypes.upperAlpha.test(marker)) listType = "A";
//         else if (orderedListTypes.lowerRoman.test(marker)) listType = "i";
//         else if (orderedListTypes.upperRoman.test(marker)) listType = "I";

//         // Determine the starting number for numbered lists
//         if (orderedListTypes.number.test(marker)) {
//             startNumber = parseInt(marker, 10);
//         }

//         // Handle nesting
//         if (currentIndent > lastIndent) {
//             indentStack.push(items);
//             items = [];
//         } else if (currentIndent < lastIndent && indentStack.length > 0) {
//             items = indentStack.pop();
//         }

//         lastIndent = currentIndent;
//         items.push({
//             type: "list_item",
//             raw,
//             text,
//             tokens: marked.lexer(text)
//         });
//     }

//     return {
//         type: "list",
//         raw: src,
//         ordered: true,
//         start: startNumber,
//         loose: false,
//         items,
//         listType
//     };
//   }
// };
// marked.use({ renderer, tokenizer });

// Ensure wiki directory exists
if (!fs.existsSync(WIKI_DIR)) {
    fs.mkdirSync(WIKI_DIR, { recursive: true });
}

// // Basic Markdown to HTML conversion using regex
// function markdownToHtml(markdown, req) {
//   //return marked.parse( markdown );

//   markdown = markdown
//     .replace(/^# ([^\n]*)$/gm, "<h1>$1</h1>") // # Header
//     .replace(/^## ([^\n]*)$/gm, "<h2>$1</h2>") // ## Sub-header
//     .replace(/^### ([^\n]*)$/gm, "<h3>$1</h3>") // ## Sub-header
//     .replace(/^#### ([^\n]*)$/gm, "<h4>$1</h4>") // ## Sub-header
//     .replace(/^##### ([^\n]*)$/gm, "<h5>$1</h5>") // ## Sub-header
//     .replace(/\*\*([^*\n]+)\*\*/gm, "<b>$1</b>") // **bold**
//     .replace(/\*([^*\n]+)\*/gm, "<i>$1</i>") // *italic*
//     .replace(/^```\s*[\n]?(.*?)[\n]?```/gms, "<code>$1</code>") // ```code```
//     .replace(/`([^`\n]+)`/gm, "<tt>$1</tt>") // `code`
//     .replace(/\[([^\]\n]+)\]\(([^\)\n]+)\)/g, (match, title, url) => {
//       const VERBOSE=false
//       VERBOSE && console.log( "[markdown] link", url.match( /^\// ) ? url : `${req.baseUrl}${view_route}/${url}` )
//       return `<a href="${url.match( /^\// ) ? url : `${req.baseUrl}${view_route}/${url}`}">${title}</a>` // [link](to url)
//     })

//   // tables:
//   // | Header 1 | Header 2 | Header 3 |
//   // |:---------|:--------:|---------:|                    <-- optional, creates heading columns if present
//   // | Row 1, Col 1 | Row 1, Col 2 | Row 1, Col 3 |
//   // | Row 2, Col 1 | Row 2, Col 2 | Row 2, Col 3 |
//   markdown = markdown.replace( /^(\|.+\|\n)((\|:?-+:?)+\|\n)?((\|.+\|\n)*)/gm, (match, firstline, nextline, nextline_col, lastlines, lastline ) => {
//     const VERBOSE=false
//     firstline = firstline.replace(/\n$/, '');
//     nextline = nextline.replace(/\n$/, '');
//     lastlines = lastlines ? lastlines.replace(/\n$/,'').split( "\n" ) : []
//     justification = nextline ? nextline.replace( /(:?)([-_=]+)(:?)/g, (m, left, dashes, right) => left && right ? "center" : right ? "right" : "left").replace(/(^\||\|$)/g,'').split('|') : undefined
//     let lines = [ firstline, ...lastlines ]

//     VERBOSE && console.log( "[markdown] table: firstline: ", firstline )
//     VERBOSE && console.log( "[markdown] table: nextline:  ", nextline )
//     VERBOSE && lastlines.forEach( r => console.log( "[markdown] table: lastlines: ", r ) )
//     VERBOSE && nextline && console.log( "[markdown] table: justify:   ", justification )
//     VERBOSE && console.log( "[markdown] table: lines", lines )

//     let result = "<table class='markdown-table'>"
//     let whichline = 0
//     lines.forEach( line => {
//       let is_heading = nextline && whichline == 0
//       VERBOSE && console.log( `[markdown] table:  o line[${whichline.toString().padStart(lines.length.toString().length, "0")}]:'${line}'${is_heading ? " <-- heading" : ""}` )
//       result += `<${is_heading ? "thead" : "tbody"}><tr>`
//       let whichcol = -1
//       result += line.replace( /\|\s*([^\|\n]+?)\s*(?=\||\|$)/g, (match, content) => {
//         ++whichcol
//         let just = justification[Math.min( justification.length, whichcol )];
//         VERBOSE && console.log( `[markdown] table:    - ${is_heading ? "heading" : "content"}:'${content}' col:'${whichcol}' just:'${just}'` )
//         return `<${is_heading?'th':'td'} style='text-align:${just};'>${content}</${is_heading?'th':'td'}>`
//       }).replace( /\s*\|$/, '' ) // eat the last trailing |
//       result += `</tr></${is_heading ? "thead" : "tbody"}>`
//       ++whichline
//     })
//     result += "</table>"
//     VERBOSE && console.log( `[markdown] table: html:${result}` )
//     return result
//   })

//   // nested lists
//   // * my bullet
//   //   1. my hindu numbered bullets
//   //     i. my roman numbered bullets
//   //     ii. my roman numbered bullets
//   //     iii. my roman numbered bullets
//   //       a. my english alphabet lowercase bullets
//   //         A. my english alphabet uppercase bullets
//   //           8. can begin at any 'number' in whatever numeric alphabet (except 'i')
//   //           3. but, subsequent ones will auto-number (ignores your typed number on the 2-n ones)
//   //             i. beginning with 'i' starts a roman numbered list, rather than "starting at 'i'" english alphabet list, sad but nessesary.
//   //   2. continuing from 1 above
//   for (let depth = 6; depth >= 0; --depth) { // Depth levels
//     let indent = " ".repeat(1 + depth * 2) + "?"; // Match increasing indentation levels

//     // unordered lists (-, +, *)
//     markdown = markdown.replace( new RegExp( `(?:^|\\n)((${indent})([-+*]) .*(?:\\n\\2\\3 .*)*)`, "gim" ), (match, match2, indents, bullet) => {
//       return `<ul>` + match.replace( /^\s*[-+*]\s+(.*?)$/gim, `<li>$1</li>` ).replace(/\n/g,"") + `</ul>` // * bullet
//     })
//     // numbered lists (1., 2., 3., etc.)
//     markdown = markdown.replace( new RegExp( `(?:^|\\n)((${indent})([0-9]+|[a-z]+|[A-Z]+|[IVXLCDM]+|[ivxlcdm]+)\\. .*(?:\\n\\2([0-9]+|[a-z]+|[A-Z]+|[IVXLCDM]+|[ivxlcdm]+)\\. .*)*)`, "gim" ), (match, match2, indents, bullet) => {
//       // type="1"	The list items will be numbered with numbers (default)
//       // type="A"	The list items will be numbered with uppercase letters
//       // type="a"	The list items will be numbered with lowercase letters
//       // type="I"	The list items will be numbered with uppercase roman numbers
//       // type="i"	The list items will be numbered with lowercase roman numbers
//       let type = bullet.match(/[0-9]+/) ? "1" :
//                  bullet.match(/[i]+/) ? "i" :  // roman numeral.   just i, since it overlaps with a-z
//                  bullet.match(/[a-z]+/) ? "a" :
//                  bullet.match(/[i]+/) ? "I" : // roman numeral.   just i, since it overlaps with a-z
//                  bullet.match(/[A-Z]+/) ? "A" :
//                  "1"
//       return `<ol type="${type}" start="${bullet}">` + match.replace( /^\s*([0-9]+|[a-z]+|[A-Z]+|[IVXLCDM]+|[ivxlcdm]+)\.\s+(.*?)$/gim, `<li>$2</li>` ).replace(/\n/g,"") + `</ol>` // * bullet
//     })
//   }

//   // blockquote >, >>, >>>
//   markdown = markdown.replace(/(^>+[^\S\r\n]?.*?(?:\n>+[^\S\r\n]?.*)*)(?=\n[^>]|$)/gm, (match) => {
//     // Map lines to { level, content }
//     const lines = match.trim().split('\n').map(line => {
//         const level = line.match(/^>+/)[0].length; // Count number of '>'
//         const content = line.replace(/^>+\s?/, ''); // Remove '>' and space
//         return { level, content };
//     });

//     // Combine consecutive lines of the same "level"
//     const reducedLines = lines.reduce((acc, curr) => {
//         const prev = acc[acc.length - 1];
//         if (prev && prev.level === curr.level) {
//             prev.content += ' ' + curr.content; // Merge lines with same level
//         } else {
//             acc.push(curr);
//         }
//         return acc;
//     }, []);

//     // Convert to nested blockquotes using a stack
//     let result = '';
//     let stack = [];
//     for (const { level, content } of reducedLines) {
//         while (stack.length > level) {
//             result += '</blockquote>';
//             stack.pop();
//         }
//         while (stack.length < level) {
//             result += '<blockquote>';
//             stack.push('<blockquote>');
//         }
//         result += content + '\n';
//     }
//     while (stack.length) {
//         result += '</blockquote>';
//         stack.pop();
//     }
//     return result.trim();
//   });

//   return markdown
//   .replace(/^\s*\n(?:\s*\n)*/gm, "<p>") // New lines to <p>
//   .replace(/\n/gm, "<br>") // New lines to <br>
// }

function wrapWithFrame(content, topic, req) {
  return template.file( "page.template.html", {
    TITLE,
    ASSETS_MAGIC,
    BACKBUTTON_PATH: `/`,
    BACKBUTTON_VISIBILITY: `hidden`,
    PAGE_TITLE: `<a href="${req.baseUrl}">/</a>${topic} ${req.user ? `(<a href="${req.baseUrl}${edit_route}/${topic}">edit</a>)`:``}`,
    USER: `${req.user}`,
    BODY: `<div style="padding-left: 2em;padding-right: 2em;padding-top: 1em;padding-bottom: 1em;">${content}</div>`
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
  return topic.replace( /[^\p{L}0-9 \-_]/ug, '' ).substring(0, 255)
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
  logger.warn(`[guard] : ${req_path} - TODO set up the guards!`);

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

// default (redirect to "view")
router.get(`/`, (req, res) => {
  res.redirect(`${req.baseUrl}${view_route}`);  // Redirects to another route in the same app
});

// VIEW
// GET ${req.baseUrl}${view_route}/:topic?/:version?  (get the page view as HTML)
router.get(`${view_route}/:topic?/:version?`, (req, res) => {
  const { topic, version } = {
    topic: sanitizeTopic( decodeURIComponent( req.params.topic ? `${req.params.topic}` : "index" ) ),  // Default to index if no topic provided
    version: req.params.version ? `.${sanitizeInt( decodeURIComponent( req.params.version ) )}` : "" // Default to empty string if no version provided
  };
  logger.info(`[wiki] ${view_route}/${topic}/${version}`);

  const filePath = sanitize( WIKI_DIR, `${topic}${version}.md`).fullPath
  if (filePath == "") {
    logger.error(`[wiki] ${view_route}/ 403 Forbidden '${topic}'`);
    return res.status(403).send(`Forbidden`);
  }
  if (!fs.existsSync(filePath)) {
    logger.info(`[wiki] ${view_route}/${topic}/${version} NOT FOUND: ${topic}${version}.md`);
    //return res.status(404).send("Topic not found.");
    const editUrl = `${req.baseUrl}${edit_route}/${topic}`;
    return res.send(`
      <p>Topic "${topic}" not found.</p>
      <p><a href="${editUrl}">Click here</a> to create or edit this topic.</p>
    `);
  }

  const markdown = fs.readFileSync(filePath, "utf8");
  const html = wrapWithFrame(markdownToHtml(markdown, `${req.baseUrl}${view_route}`), topic, req);
  res.send(html);
});

// SAVE
// PUT /save   (write page markdown;  req.body: { topic: "TOPICNAME", content: "Markdown content" })
router.put("/save", express.json(), (req, res) => {
  const { topic, content } = {
    topic: sanitizeTopic( req.body.topic ),
    content: req.body.content,
  }
  if (!topic || !content) {
    logger.error(`[wiki] /save 400 Missing topic or content`);
    return res.status(400).send("Missing topic or content.");
  }

  if (topic == "" || sanitizeTopic( topic ) != topic) {
    logger.error(`[wiki] /save 403 Forbidden '${topic}'`);
    return res.status(403).send(`Forbidden`);
  }
  logger.info(`[wiki] /save ${topic} content (save)`);

  // Find the next version number
  let existing_versions = readdirSync( WIKI_DIR, new RegExp( `^${topic}\\.?[0-9]*\\.md$` ) );
  let version = existing_versions.length == 0 ? 1 : existing_versions.length;

  // debugging... break out early
  // logger.error(`[wiki] /save Debugging found:${existing_versions.length} next_version:${version} list:${JSON.stringify( existing_versions )}`);
  // return res.status(403).send(`Debugging found:${existing_versions.length} next_version:${version} list:${JSON.stringify( existing_versions )}`);

  const latestFilePath = sanitize( WIKI_DIR, `${topic}.md`).fullPath
  if (latestFilePath == "") {
    logger.error(`[wiki] /save 403 Forbidden '${topic}'`);
    return res.status(403).send(`Forbidden`);
  }

  const versionedFilePath = sanitize( WIKI_DIR, `${topic}.${version}.md`).fullPath
  if (versionedFilePath == "") {
    logger.error(`[wiki] /save 403 Forbidden '${topic}'`);
    return res.status(403).send(`Forbidden`);
  }

  logger.info(`[wiki] /save ${topic} ${version} version (save)`);
  fs.writeFileSync(versionedFilePath, content, "utf8");
  fs.writeFileSync(latestFilePath, content, "utf8");
  res.json({ message: "Wiki page updated.", version });
});

// EDIT
// GET ${req.baseUrl}${edit_route}/:topic    (edit page)
router.get(`${edit_route}/:topic`, (req, res) => {
  const topic = req.params.topic ? sanitizeTopic( decodeURIComponent( req.params.topic ) ) : undefined;
  if (!topic) {
    logger.error(`[wiki] ${edit_route} 400 Missing topic name`);
    return res.status(400).send("Missing topic name.");
  }

  const filePath = sanitize( WIKI_DIR, `${topic}.md` ).fullPath
  if (filePath == "") {
    logger.error(`[wiki] ${edit_route} 403 Forbidden '${topic}'`);
    return res.status(403).send(`Forbidden`);
  }

  logger.info(`[wiki] ${edit_route} ${topic} ${filePath}`);
  const markdown = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  res.send(`
    <html>
    <head>
      <title>Edit Wiki: ${topic}</title>
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
            alert(\`Msg:'\${data.message}' Ver:'\${data.version}'\`);
            // Redirect to the view page for the updated topic
            window.location.href = "${req.baseUrl}${view_route}/${topic}";
          });
        }

        // Ensure updatePreview() runs once when the page loads
        document.addEventListener("DOMContentLoaded", () => {
          updatePreview();
        });
      </script>
      <style>
      .markdown-table {
          border-collapse: collapse; width: 100%;
        }
        .markdown-table tbody td, .markdown-table thead th {
          border: 1px solid lightgrey;
          padding: 0;
        }
          </style>
    </head>
    <body>
      <h1>Edit Wiki: ${topic}</h1>
      <textarea id="markdown" onkeyup="updatePreview()" rows="10" cols="50">${markdown}</textarea>
      <button onclick="window.location.href = '${req.baseUrl}/view/${topic}'">Cancel</button>
      <button onclick="saveWiki()">Save</button>
      <h2>Preview:</h2>
      <div id="preview"></div>
    </body>
    </html>
  `);
});


// GET /markdown/:topic/:version?   (get the page markdown data)
router.get("/markdown/:topic/:version?", (req, res) => {
  const { topic, version } = {
    topic: req.params.topic ? sanitizeTopic( decodeURIComponent( `${req.params.topic}` ) ) : undefined,
    version: req.params.version ? `.${sanitizeInt( decodeURIComponent( req.params.version ) )}` : ""
  };
  logger.info(`[wiki] /markdown/${topic}/${version}`);

  if (!topic) {
    logger.error(`[wiki] /markdown 400 Missing topic name.`);
    return res.status(400).send("Missing topic name.");
  }

  const filePath = path.join(WIKI_DIR, `${topic}${version}.md`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).send("Topic not found.");
  }

  res.sendFile(filePath);
});


// POST ${req.baseUrl}/preview (submit req.body: { content: <markdown> }, get HTML; used for live preview in edit page)
router.post("/preview", express.json(), (req, res) => {
  const { content } = req.body; // markdown
  if (!content) {
    logger.error(`[wiki] /preview 400 Missing content`);
    return res.status(400).send("Missing content.");
  }
  res.send(markdownToHtml(content, `${req.baseUrl}${view_route}`));
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
  test_sanitizeTopic( "Hello_World - 123!@#Γεια_σου-🌍", "Hello_World - 123Γεια_σου-" );
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

