const fs = require("fs");
const path = require("path");
const express = require("express");
const router = express.Router();
const sanitizer = require('./sanitizer');
const { sanitize, sanitizeFloat, sanitizeInt, sanitizeTopic } = sanitizer;
const template = require('./template');
const { markdownToHtml, htmlToMarkdown } = require('./markdown')
const { init: markdownTests } = require('./markdown-tests')
markdownTests();
const { guardForProdHostOnly, redirectAnonUsersToStaticSite } = require("./router-auth");
const { userLogDisplay, getReferrerFromReq } = require("./common")

const settings = require('./settings');

let greek_roots
try {greek_roots = require('./wiki/greek-roots.json')} catch(error) {console.log( "INFO: you may define greek-roots.json with [ { \"root\": \"ἔχιδν-\" }, { \"root\": \"χρ-\" } ]" )}

function dedupeGreekRoots(arr) {
  const seen = new Set();
  return arr.filter(entry => {
    if (seen.has(entry.root)) {
      return false; // skip duplicates
    }
    seen.add(entry.root);
    return true;
  });
}

const greek_roots_dedupe = dedupeGreekRoots(greek_roots);

// Full irregular mi-verbs dictionary with singular + plural
const irregularMiVerbsFull = {
  "δίδω": {
    present: {
      singular: { 1: "δίδωμι", 2: "δίδως", 3: "δίδωσι(ν)" },
      plural: { 1: "δίδομεν", 2: "δίδοτε", 3: "δίδοασι(ν)" }
    },
    future: {
      singular: { 1: "δώσω", 2: "δώσεις", 3: "δώσει" },
      plural: { 1: "δώσομεν", 2: "δώσετε", 3: "δώσουσι(ν)" }
    },
    aorist: {
      singular: { 1: "ἔδωκα", 2: "ἔδωκας", 3: "ἔδωκε(ν)" },
      plural: { 1: "ἐδώκαμεν", 2: "ἐδώκατε", 3: "ἔδωκαν" }
    }
  },
  "τίθη": {
    present: {
      singular: { 1: "τίθημι", 2: "τίθης", 3: "τίθησι(ν)" },
      plural: { 1: "τίθεμεν", 2: "τίθετε", 3: "τίθεασι(ν)" }
    },
    future: {
      singular: { 1: "θήσω", 2: "θήσεις", 3: "θήσει" },
      plural: { 1: "θήσομεν", 2: "θήσετε", 3: "θήσουσι(ν)" }
    },
    aorist: {
      singular: { 1: "ἔθηκα", 2: "ἔθηκας", 3: "ἔθηκε(ν)" },
      plural: { 1: "ἐθήκαμεν", 2: "ἐθήκατε", 3: "ἔθηκαν" }
    }
  },
  "ἵστη": {
    present: {
      singular: { 1: "ἵστημι", 2: "ἵστης", 3: "ἵστησι(ν)" },
      plural: { 1: "ἵσταμεν", 2: "ἵστατε", 3: "ἵστασαν" }
    },
    future: {
      singular: { 1: "στήσω", 2: "στήσεις", 3: "στήσει" },
      plural: { 1: "στήσομεν", 2: "στήσετε", 3: "στήσουσι(ν)" }
    },
    aorist: {
      singular: { 1: "ἔστησα", 2: "ἔστησας", 3: "ἔστησε(ν)" },
      plural: { 1: "ἐστήσαμεν", 2: "ἐστήσατε", 3: "ἔστησαν" }
    }
  },
  "ἵη": {
    present: {
      singular: { 1: "ἵημι", 2: "ἵης", 3: "ἵησι(ν)" },
      plural: { 1: "ἵεμεν", 2: "ἵετε", 3: "ἵεσαν" }
    },
    future: {
      singular: { 1: "ἥσω", 2: "ἥσεις", 3: "ἥσει" },
      plural: { 1: "ἥσομεν", 2: "ἥσετε", 3: "ἥσουσι(ν)" }
    },
    aorist: {
      singular: { 1: "ἧκα", 2: "ἧκας", 3: "ἧκε(ν)" },
      plural: { 1: "ἧκαμεν", 2: "ἧκατε", 3: "ἧκαν" }
    }
  }
};

// Function to generate full tables for any verb type
function generateFullVerbForms(entry) {
  const { root, hints } = entry;
  const vtype = hints.verbType || "omega";
  const forms = {};

  // Irregular mi-verbs
  if (vtype === "mi" && irregularMiVerbsFull[root]) {
    return irregularMiVerbsFull[root];
  }

  // Contract verbs (ε-, α-, ο-) full singular + plural
  if (vtype === "contract") {
    const contractType = hints.contractType || "epsilon";
    forms.present = { singular: {}, plural: {} };
    for (let pers in verbEndings.contract[contractType]) {
      if (["1s","2s","3s"].includes(pers)) {
        forms.present.singular[pers] = root + verbEndings.contract[contractType][pers];
      } else {
        const plMap = {"1p":"1","2p":"2","3p":"3"}; // map person keys
        forms.present.plural[plMap[pers]] = root + verbEndings.contract[contractType][pers];
      }
    }
    return forms;
  }

  // Regular omega or mi verbs
  if (vtype === "omega" || vtype === "mi") {
    forms.present = { singular: {}, plural: {} };
    forms.future = { singular: {}, plural: {} };
    forms.aorist = { singular: {}, plural: {} };
    for (let tense in verbEndings[vtype]) {
      for (let pers in verbEndings[vtype][tense]) {
        const group = ["1s","2s","3s"].includes(pers) ? "singular" : "plural";
        const plMap = {"1p":"1","2p":"2","3p":"3"};
        const key = group === "singular" ? pers : plMap[pers];
        forms[tense][group][key] = root + verbEndings[vtype][tense][pers];
      }
    }
  }

  return forms;
}

let apps = []
let app_name;

// selector
router.get(`/`, (req, res) => {
  console.log( "[greek] selector screen" )
  return res.send(`
    Greek Learning Apps:
    <ul>
    ${apps.map( r => `<li><a href="${req.baseUrl}/${r}">${r}</a></li>`).join("\n")}
    </ul>
  `);
});


function commonPageVars(req, app_name, t=new Date() ) {
  return {
    ...settings, ...{ CANONICAL_URL: req.canonicalUrl, CANONICAL_URL_ROOT: req.canonicalUrlRoot, CANONICAL_URL_DOMAIN: req.canonicalUrlDomain, CURRENT_DATETIME: t.toISOString().replace(/\.\d{3}Z$/, '+0000') },
    TITLE: `${settings.TITLE}`,
    SOCIAL_TITLE: `${settings.TITLE}`,
    BACKBUTTON_PATH: `/`,
    BACKBUTTON_VISIBILITY: `visible`,//`hidden`,
    BACKBUTTON_IMAGE: `/${settings.ASSETS_MAGIC}/home_24dp_E3E3E3_FILL0_wght400_GRAD0_opsz24.svg`,
    PAGE_TITLE: `<a href="${req.baseUrl}">${req.baseUrl}</a>/<a href="${app_name}">${app_name}</a>`,
    USER: `${req.user}`,
    SCROLL_CLASS: "scroll-child-wiki",
    WHITESPACE: "normal",
    REQ_BASEURL: req.baseUrl,
    SEARCH_URL: `${req.baseUrl}/search`,
    SEARCH: `<span id="search" onclick='search()'><img src="/${settings.ASSETS_MAGIC}/search_24dp_E3E3E3_FILL0_wght400_GRAD0_opsz24.svg"/ alt="[search]" title="[search]"></span>`,
    USER_LOGOUT: ``,
  };
}

function generateCatchHTML(err){
  return `
    ${err}<BR>
    <pre>${err.stack}</pre>
  `
}

app_name = "list_all_roots_table"
apps.push( app_name )
router.get(`/${app_name}`, (req, res) => {
  const app_name = req.route.path.replace(/^\//, '');
  try {
    console.log( `[greek] ${app_name} app` )
    const new_roots = greek_roots
    const headings = Object.keys( new_roots[0] );
    let str = `<table>${headings.map( key => `<thead>${key}</thead>` ).join("")}\n`
    str +=    `|${Object.keys( new_roots[0] ).map( key => `--------|` ).join("")}\n`
    str +=    `${new_roots.map( r => {return "|" + headings.map( key => ` ${r[key] ? (typeof r[key] == 'object') ? (Array.isArray( r[key] ) ? r[key].join(", ") : JSON.stringify( r[key] )) : r[key] : ''} |` ).join("")} ).join("\n")}\n`
    return res.send(
      template.file( "template.page.html", {
        ...commonPageVars(req, app_name),
        BODY: `
          ${new_roots.length} total:<BR>
          <!-- json: <pre>${JSON.stringify( new_roots )}</pre><br>
          markdown: <pre>${str}</pre><br> -->
          ${markdownToHtml( str )}
        `
      })
    );
  } catch (err) {
    return res.send(generateCatchHTML(err));
  }
});

app_name = "list_all_roots_json"
apps.push( app_name )
router.get(`/${app_name}`, (req, res) => {
  const app_name = req.route.path.replace(/^\//, '');
  try {
    console.log( `[greek] ${app_name} app` )
    const new_roots = greek_roots
    let str = new_roots.map( r => JSON.stringify( r ) ).join(",<BR>");
    return res.send(
      template.file( "template.page.html", {
        ...commonPageVars(req, app_name),
        BODY: `
          ${new_roots.length} total:<BR>
          [<BR>
          ${str}<BR>
          ]
        `
      })
    )
  } catch (err) {
    return res.send(generateCatchHTML(err));
  }
});

app_name = "list_all_roots_brief"
apps.push( app_name )
router.get(`/${app_name}`, (req, res) => {
  const app_name = req.route.path.replace(/^\//, '');
  try {
    console.log( `[greek] ${app_name} app` )
    const new_roots = greek_roots_dedupe
    let str_roots = new_roots.map( r => r.root ).join(", ");
    return res.send(
      template.file( "template.page.html", {
        ...commonPageVars(req, app_name),
        BODY: `
          ${new_roots.length} unique roots:<BR>
          ${str_roots}
        `
      })
    )
  } catch (err) {
    return res.send(generateCatchHTML(err));
  }
});

app_name = "vocabulary_quiz"
apps.push( app_name )
router.get(`/${app_name}`, (req, res) => {
  const app_name = req.route.path.replace(/^\//, '');
  try {
    console.log(`[greek] ${app_name} app`);
    const new_roots = greek_roots_dedupe;

    // Pick a random root for this quiz
    const root = new_roots[Math.floor(Math.random() * new_roots.length)];

    // pick 3 random wrong meanings
    let wrongOptions = [];
    while (wrongOptions.length < 3) {
      const randomRoot = new_roots[Math.floor(Math.random() * new_roots.length)];
      if (randomRoot.meaning !== root.meaning && !wrongOptions.includes(randomRoot.meaning)) {
        wrongOptions.push(randomRoot.meaning);
      }
    }

    // shuffle correct + wrong
    const options = [root.meaning, ...wrongOptions].sort(() => Math.random() - 0.5);

    // Insert HTML + JS for single-question quiz
    const BODY = `
      <h2>Greek Root Quiz</h2>
      <div id="quiz-container">
        <p><strong>${root.root}</strong>: What does this root mean? (${root.part_of_speech}, example: ${root.example_words.map( r => `${r}`).join(", ")})</p>
        ${options.map(opt => `
          <label>
            <input type="radio" name="answer" value="${opt}"> ${opt}
          </label><br>
        `).join("")}
      </div>
      <button id="submit-btn">Submit Answer</button>
      <div id="result"></div>
      <div id="next-timer" style="margin-top:10px;"></div>
      <button id="next-btn" style="display:none; margin-top:10px;">Next Question</button>

      <script>
        const correctAnswer = "${root.meaning}";
        const submitBtn = document.getElementById("submit-btn");
        const resultDiv = document.getElementById("result");
        const nextTimerDiv = document.getElementById("next-timer");
        const nextBtn = document.getElementById("next-btn");

        submitBtn.addEventListener("click", () => {
          const selected = document.querySelector('input[name="answer"]:checked');
          if (!selected) {
            resultDiv.innerHTML = "<p>Please select an option!</p>";
            return;
          }

          submitBtn.disabled = true; // prevent multiple submits

          if (selected.value === correctAnswer) {
            resultDiv.innerHTML = "<p style='color:green'>Correct!</p>";

            // start countdown
            let seconds = 4;
            nextTimerDiv.innerHTML = "Next question in " + seconds + " seconds...";
            const countdown = setInterval(() => {
              seconds--;
              nextTimerDiv.innerHTML = "Next question in " + seconds + " seconds...";
              if (seconds <= 0) {
                clearInterval(countdown);
                location.reload(); // reload the page for next question
              }
            }, 1000);

          } else {
            resultDiv.innerHTML = "<p style='color:red'>Wrong! Correct answer: " + correctAnswer + "</p>";
            nextBtn.style.display = "inline-block"; // show manual next button
          }
        });

        nextBtn.addEventListener("click", () => {
          location.reload(); // manually reload for next question
        });
      </script>
    `;


    return res.send(
      template.file("template.page.html", {
        ...commonPageVars(req, app_name),
        BODY
      })
    );

  } catch (err) {
    return res.send(generateCatchHTML(err));
  }
});



//////////////////////////////////////////


function init( l ) {
  logger = l;
}

// Plug into Express
module.exports.router = router;
module.exports.init = init;
