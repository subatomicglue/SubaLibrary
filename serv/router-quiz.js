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

function loadDataJSON( filename = './wiki/greek-roots.json', example = `[ { \"root\": \"ἔχιδν-\" }, { \"root\": \"χρ-\" } ]` ) {
  let data = [];
  try {data = require(filename)} catch(error) {console.log( `INFO: you may define ${filename} with ${example}` )}
  return data;
}

function dedupe(arr, key="root") {
  const seen = new Set();
  return arr.filter(entry => {
    if (seen.has(entry[key])) {
      return false; // skip duplicates
    }
    seen.add(entry[key]);
    return true;
  });
}

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
let page_builders = {}

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
  const assets_magic = req.staticMode ? "assets" : settings.ASSETS_MAGIC;

  return {
    ...settings, ...{ CANONICAL_URL: req.canonicalUrl, CANONICAL_URL_ROOT: req.canonicalUrlRoot, CANONICAL_URL_DOMAIN: req.canonicalUrlDomain, CURRENT_DATETIME: t.toISOString().replace(/\.\d{3}Z$/, '+0000') },
    TITLE: `${settings.TITLE}`,
    SOCIAL_TITLE: `${settings.TITLE} - ${req.baseUrl}/${app_name}`,
    BACKBUTTON_PATH: `/`,
    BACKBUTTON_VISIBILITY: `visible`,//`hidden`,
    BACKBUTTON_IMAGE: `/${assets_magic}/home_24dp_E3E3E3_FILL0_wght400_GRAD0_opsz24.svg`,
    PAGE_TITLE: `<a href="${req.baseUrl}">${req.baseUrl}</a>/<a href="${app_name}">${app_name}</a>`,
    USER: `${req.user}`,
    SCROLL_CLASS: "scroll-child-wiki",
    WHITESPACE: "normal",
    REQ_BASEURL: req.baseUrl,
    SEARCH_URL: `${req.baseUrl}/search`,
    SEARCH: `<span id="search" onclick='search()'><img src="/${assets_magic}/search_24dp_E3E3E3_FILL0_wght400_GRAD0_opsz24.svg" alt="[search]" title="[search]"></span>`,
    USER_LOGOUT: ``,
    ASSETS_MAGIC: assets_magic
  };
}

function generateCatchHTML(err){
  return `
    ${err}<BR>
    <pre>${err.stack}</pre>
  `
}


function transliterateGreek(text) {
  // Normalize text to NFD (decomposed) form to separate accents
  const normalized = text.normalize('NFD');

  // Mapping of Greek letters to Latin transliteration
  const greekMap = {
    'α': 'a', 'ά': 'a', 'ἀ':'a','ἁ':'a','ἄ':'a','ἅ':'a','ἂ':'a','ἃ':'a','ἆ':'a','ἇ':'a',
    'β': 'b',
    'γ': 'g',
    'δ': 'd',
    'ε': 'e','έ':'e','ἐ':'e','ἑ':'e','ἒ':'e','ἓ':'e','ἔ':'e','ἕ':'e',
    'ζ': 'z',
    'η': 'ē','ή':'ē','ἠ':'ē','ἡ':'ē','ἤ':'ē','ἥ':'ē','ἢ':'ē','ἣ':'ē','ἦ':'ē','ἧ':'ē',
    'θ': 'th',
    'ι': 'i','ί':'i','ϊ':'i','ΐ':'i','ἰ':'i','ἱ':'i','ἴ':'i','ἵ':'i','ἲ':'i','ἳ':'i','ἶ':'i','ἷ':'i',
    'κ': 'k',
    'λ': 'l',
    'μ': 'm',
    'ν': 'n',
    'ξ': 'x',
    'ο': 'o','ό':'o','ὀ':'o','ὁ':'o','ὂ':'o','ὃ':'o','ὄ':'o','ὅ':'o',
    'π': 'p',
    'ρ': 'r','ῤ':'r','ῥ':'r',
    'σ': 's','ς':'s',
    'τ': 't',
    'υ': 'u','ύ':'u','ϋ':'u','ΰ':'u','ὐ':'u','ὑ':'u','ὔ':'u','ὕ':'u','ὒ':'u','ὓ':'u','ὖ':'u','ὗ':'u',
    'φ': 'ph',
    'χ': 'ch',
    'ψ': 'ps',
    'ω': 'ou','ώ':'ou','ὠ':'ou','ὡ':'ou','ὤ':'ou','ὥ':'ou','ὢ':'ou','ὣ':'ou','ὦ':'ou','ὧ':'ou',
    // Uppercase equivalents
    'Α': 'A','Ά':'A','Β':'B','Γ':'G','Δ':'D','Ε':'E','Έ':'E','Ζ':'Z','Η':'Ē','Ή':'Ē','Θ':'Th',
    'Ι':'I','Ί':'I','Κ':'K','Λ':'L','Μ':'M','Ν':'N','Ξ':'X','Ο':'O','Ό':'O','Π':'P','Ρ':'R',
    'Σ':'S','Τ':'T','Υ':'Y','Ύ':'Y','Φ':'Ph','Χ':'Ch','Ψ':'Ps','Ω':'Ou','Ώ':'Ou'
  };

  // Remove diacritics
  const stripped = normalized.replace(/[\u0300-\u036f]/g, '');

  // Transliterate each character
  let result = '';
  for (const char of stripped) {
    result += greekMap[char] !== undefined ? greekMap[char] : char;
  }
  return result;
}


/**
 * Declines a noun given its vocab entry and target case/number.
 * @param {Object} vocabEntry - vocab entry (root, hints, gender, etc.)
 * @param {String} nounCase - e.g. "NOMINATIVE", "GENITIVE", ...
 * @param {String} number - "singular" or "plural"
 * @returns {String} declined form
 */
function declineNoun(vocabEntry, nounCase, number) {
  const decl = vocabEntry.hints.declension; // "first" / "second"
  let gender = vocabEntry.gender;           // "feminine", "masculine", "neuter"

  // Normalize gender key for 2nd decl masc/fem
  if (decl === "second" && (gender === "masculine" || gender === "feminine")) {
    gender = "masculine/feminine";
  }

  const nounDeclension = require(`${settings.WIKI_DIR}/greek-units.json`)["noun declension"];
  let table = nounDeclension[decl][gender];

  // Special case: first decl feminine with roots ending in ε,ι,ρ
  if (decl === "first" && gender === "feminine") {
    const lastChar = vocabEntry.root.slice(-1);
    if (["ε", "ι", "ρ"].includes(lastChar)) {
      table = nounDeclension.first["feminine (ends in ε,ι,ρ)"];
    }
  }

  if (!table) {
    throw new Error(`No declension table for ${decl} ${gender}`);
  }

  const ending = table[number][nounCase];
  return vocabEntry.root.replace(/-$/, "") + ending.replace(/^-/, "");
}


// Generate quiz data
function generateDefiniteArticleQuiz(data) {
  const quiz = [];

  for (const gender in data) {
    for (const number in data[gender]) {
      for (const caseName in data[gender][number]) {
        const correct = data[gender][number][caseName];
        //console.log( `${gender} ${number} ${caseName} = ${correct}`)

        // Collect *all* possible articles to use as distractors
        const allArticles = Object.values(data)
          .flatMap(g => Object.values(g))
          .flatMap(n => Object.values(n));

        // Filter out duplicates and the correct one
        const distractors = [...new Set(allArticles)].filter(a => a !== correct);

        // Pick 3 random distractors
        const wrongAnswers = [];
        while (wrongAnswers.length < 3 && distractors.length > 0) {
          const randIndex = Math.floor(Math.random() * distractors.length);
          wrongAnswers.push(distractors.splice(randIndex, 1)[0]);
        }

        quiz.push({
          question: `${gender} ${number} ${caseName}`,
          answer: 0,
          answers: [correct, ...wrongAnswers]
        });
      }
    }
  }

  return quiz;
}

const normalize = s => (typeof s === "string" ? s.normalize("NFC") : s);
const stripDiacritics = s => normalize(typeof s === "string" ? s.normalize("NFD").replace(/\p{M}/gu, "") : s);

const stripDiacriticsLeaveBreathingMarks = s =>
  normalize(typeof s === "string"
    ? s.normalize("NFD").replace(/[\u0300\u0301\u0342\u0345\u0313\u0304]/g, "")
    : s);

function blah( data ) {

// ------------- build lookups -------------
function buildArticleLookup(data) {
  const lookup = {};
  const ads = data["definite article declension"];
  for (const gender of Object.keys(ads)) {
    for (const number of Object.keys(ads[gender])) {
      for (const kase of Object.keys(ads[gender][number])) {
        const rawForm = ads[gender][number][kase];
        const form = stripDiacriticsLeaveBreathingMarks(rawForm);
        if (!lookup[form]) lookup[form] = [];
        // store [CASE, number, gender]
        lookup[form].push([kase, number, gender]);
      }
    }
  }
  return lookup;
}

function buildNounEndingLookup(data) {
  const lookup = {};
  const decls = data["noun declension"];
  for (const decl of Object.keys(decls)) {
    for (const rawGender of Object.keys(decls[decl])) {
      const gBlock = decls[decl][rawGender];
      // normalize gender labels: "masculine/feminine" => ["masculine","feminine"]
      let genders = [];
      if (rawGender.includes("/")) genders = rawGender.split("/").map(x => x.trim());
      else if (rawGender.includes("(")) genders = [rawGender.replace(/\s*\(.*\)/, "").trim()];
      else genders = [rawGender];

      // capture rule if present on the block
      let blockRule = null;
      if (gBlock && typeof gBlock === "object" && gBlock.rule) {
        // convert ends_with object into array for easy checking
        if (gBlock.rule.ends_with) {
          blockRule = Object.keys(gBlock.rule.ends_with);
        }
      }

      for (const number of Object.keys(gBlock)) {
        if (number === "rule") continue;
        for (const kase of Object.keys(gBlock[number])) {
          let rawEnding = gBlock[number][kase];
          if (!rawEnding) continue;
          // remove leading "-" if present
          rawEnding = rawEnding.replace(/^-/, "");
          const ending = stripDiacriticsLeaveBreathingMarks(rawEnding);
          for (const gender of genders) {
            // store [CASE, number, gender, decl, ruleArray|null]
            if (!lookup[ending]) lookup[ending] = [];
            lookup[ending].push([kase, number, gender, decl, blockRule]);
          }
        }
      }
    }
  }

  return lookup;
}

  const articleLookup = buildArticleLookup(data);
  const nounEndingLookup = buildNounEndingLookup(data);
  console.log( "articleLookup:", JSON.stringify( articleLookup ) );
  console.log( "nounEndingLookup:", JSON.stringify( nounEndingLookup ) );

  // precompute sorted endings (longest first)
  const sortedEndings = Object.keys(nounEndingLookup).sort((a,b)=> b.length - a.length);

  // ------------- tokenizing & matching -------------
  function tokenize(sentence) {
    return sentence.split(/([\s\.\,\;\:\—\–\?\!]+)/).filter(t => t.length > 0);
  }


  function identifyToken(originalToken) {
    const tokenForMatch = stripDiacriticsLeaveBreathingMarks( normalize(originalToken.replace(/^[\(\[\{]+|[\)\]\}\.\,\;\:\!\?]+$/g,"")) ); // trim leading/trailing punctuation
    const matches = [];

    // article exact match
    const aMatch = articleLookup[tokenForMatch];
    // console.log( "[identifyToken - article]", tokenForMatch, articleLookup[tokenForMatch] != undefined )
    if (aMatch) {
      aMatch.forEach(m => matches.push({ type: "article", "case": m[0], "number": m[1], "gender": m[2] })); // m is [CASE,number,gender]
    }

    if (originalToken.match( /([\s\.\,\;\:\—\–\?\!]+)/ )) {
      matches.push( { type: "whitespace" })
    }

    const vocabs = require(`${settings.WIKI_DIR}/greek-roots.json`).sort( (a1, a2) => a2.root.length - a1.root.length );
    //console.log( vocabs )
    let vocab = vocabs.find( r => {
      let stem = stripDiacriticsLeaveBreathingMarks( r.root )
      let stem_regex = "^" + stem.replace( /-/, ".*" ) + "$"
      let stem_ending_regex = "^" + stem.replace( /-/, "" )
      let ending = tokenForMatch.replace( new RegExp( stem_ending_regex ), "" )
      // if (tokenForMatch.match( new RegExp( stem_regex ) ))
      //   console.log( tokenForMatch, stem, stem_regex, undefined != tokenForMatch.match( new RegExp( stem_regex ) ) )
      let checks_out = (r.part_of_speech.match( /noun$/ ) && nounEndingLookup[ending]) || (!r.part_of_speech.match( /noun$/ ));
      return checks_out && tokenForMatch.match( new RegExp( stem_regex ) );
    })
    if (vocab) {
      let stem = stripDiacriticsLeaveBreathingMarks( vocab.root ).replace( /-/, "" )
      let ending = tokenForMatch.replace( new RegExp( "^" + stem ), "" )
      vocab.ending = ending;
      matches.push({type:"vocab", stem: stem, ending, vocab: vocab});

      if (vocab && vocab.part_of_speech.match( /noun$/ )) {
        let pos = nounEndingLookup[vocab.ending];
        if (pos) {
          //console.log( "- vocab match: ", vocab.ending, nounEndingLookup[vocab.ending] )
          let relevant_rules = pos.filter( r => r[3] == vocab.hints.declension ).map( r2 => {
            matches.push({ type: "noun", "case": r2[0], "number": r2[1], "gender": r2[2], "declension": r2[3] });
          })
        }
      } else {
        matches.push({ type: vocab.part_of_speech });
      }
    }

    // if (matches.length > 0) {
    //   console.log( "MATCH!", JSON.stringify( matches ) )
    // }
    return matches;
  }

  // ------------- disambiguation using nearby articles -------------
  /**
   * Disambiguate noun matches using nearby definite articles.
   * For each token that is a noun with multiple possible tags,
   * we keep only those whose gender & number match a nearby article.
   */
  function disambiguate(tokensWithMatches) {
    const result = [];
    let once = true;

    for (let i = 0; i < tokensWithMatches.length; i++) {
      const entry = tokensWithMatches[i];
      const token = entry.token;
      let matches = entry.matches || [];

      // Separate articles and nouns
      let articleMatches = matches.filter(m => m.type === "article");
      let nounMatches = matches.filter(m => m.type === "noun");

      if (articleMatches.length > 0 && nounMatches.length > 0) {
        nounMatches = []
      }

      let debug = false;
      if (token == "ὁ") debug = true;
      //if (token == "Ὁμηρος") debug = true;
      //if (token == "Ὁμήρου") debug = true
      if (token == "ἀδελφὸς") debug = true
      debug && console.log( "[!!!!!] tokensWithMatches" + (once ? "=================================================" : "-----------------------") ); once = false;
      debug && tokensWithMatches.forEach( (r,i) => { console.log( "        --", i, JSON.stringify( r ) ) } );
      debug && console.log( "[!!!!!] entry [", token, "]", JSON.stringify( entry ) )
      debug && console.log( "[!!!!!]", " - noun matches:", nounMatches.length, ", article matches:", articleMatches.length )


      // nouns might match an article before it (some familiar nouns dont have an article, like Homer, or Gymnasium)
      if (nounMatches.length > 0) {
        debug && console.log( "[!!!!!] ==== NOUN === (looking for nearest article)", token )
        // 1️⃣ Find nearest preceding article (look back up to 2 tokens)
        let nearestArticle = undefined;
        for (let offset = -2; offset <= 0 && !nearestArticle; offset++) {
          //debug && console.log( "[!!!!!] offset", offset, (i + offset) )
          if (0 <= (i + offset)) {
            const prevEntry = tokensWithMatches[i + offset];
            debug && console.log( "[!!!!!] checking ->", offset, (i + offset), JSON.stringify( prevEntry ) )
            const prevArticles = (prevEntry.matches || []).filter(m => m.type === "article");
            if (prevArticles.length) nearestArticle = prevArticles;
          }
        }

        debug && console.log( "[!!!!!] nearestArticle", token, JSON.stringify( nearestArticle ) )

        if (nearestArticle) {
          // 2️⃣ Build mutually consistent matches: keep only combinations that match number & gender
          const validNouns = [];
          const validArticles = [];

          // find tags in common between current noun, and previous article
          // e.g. "tags":["VOCATIVE","singular","neuter","second"]
          nounMatches.forEach(nm => {
            nearestArticle.forEach(a => {
              if (nm["case"] === a["case"] && nm["number"] === a["number"] && nm["gender"] === a["gender"]) {
                validNouns.push(nm);
                validArticles.push(a);
              }
            });
          });
          debug && console.log( "[!!!!!] validNouns", token, JSON.stringify( validNouns ) )
          debug && console.log( "[!!!!!] validArticles", token, JSON.stringify( validArticles ) )

          // Deduplicate article matches
          articleMatches = [...new Map(validArticles.map(a => [a.value + [a["case"],a["number"],a["gender"],a["declension"]].join(","), a])).values()];
          nounMatches = validNouns;
        } else {
          // 3️⃣ No preceding article: assume NOMINATIVE for nouns
          nounMatches = nounMatches.filter(nm => nm["case"] === "NOMINATIVE");
          // Also prune articles if any were incorrectly matched
          articleMatches = [];
        }
      }

      // articles should match a noun after it
      else if (articleMatches.length > 0) {
        debug && console.log( "[!!!!!]  ==== ARTICLE === (looking for nearest noun)", token )
        // 1️⃣ Find nearest following noun (look fwd up to 2 tokens)
        let nearestNoun = undefined;
        for (let offset = 0; offset <= 2 && !nearestNoun; offset++) {
          //debug && console.log( "[!!!!!] offset", offset, (i + offset) )
          if (0 <= (i + offset)) {
            const prevEntry = tokensWithMatches[i + offset];
            debug && console.log( "[!!!!!] checking -> ", offset, (i + offset), JSON.stringify( prevEntry ) )
            const prevNouns = (prevEntry.matches || []).filter(m => m.type === "noun");
            if (prevNouns.length) nearestNoun = prevNouns;
          }
        }

        debug && console.log( "[!!!!!] nearestNoun", token, JSON.stringify( nearestNoun ) )

        if (nearestNoun) {
          // 2️⃣ Build mutually consistent matches: keep only combinations that match number & gender
          const validNouns = [];
          const validArticles = [];

          // find tags in common between current noun, and previous article
          // e.g. "tags":["VOCATIVE","singular","neuter","second"]
          articleMatches.forEach(am => {
            nearestNoun.forEach(n => {
              if (am["case"] === n["case"] && am["number"] === n["number"] && am["gender"] === n["gender"]) {
                validNouns.push(am);
                validArticles.push(n);
              }
            });
          });
          debug && console.log( "[!!!!!] validNouns", token, JSON.stringify( validNouns ) )
          debug && console.log( "[!!!!!] validArticles", token, JSON.stringify( validArticles ) )

          // Deduplicate article matches
          articleMatches = [...new Map(validArticles.map(a => [a.value + [a["case"],a["number"],a["gender"],a["declension"]].join(","), a])).values()];
          nounMatches = validNouns;
        } else {
          // 3️⃣ No preceding article: assume NOMINATIVE for nouns
          nounMatches = nounMatches.filter(nm => nm.tags[0] === "NOMINATIVE");
          // Also prune articles if any were incorrectly matched
          articleMatches = [];
        }
      }

      // Combine back
      const finalMatches = [...articleMatches, ...nounMatches];
      result.push({ token, matches: finalMatches });
      debug && console.log( "[!!!!!] result", token, JSON.stringify( result ) )
    }

    return result;
  }

  // ------------- bracket by case -------------
  function bracketByCase(sentence, kase) {
    const tokens = tokenize( sentence );
    tokens = tokens.map( r => ({ token: r, stripped: stripDiacriticsLeaveBreathingMarks( r )}))
    // map tokens to objects that contain matches
    let tokensWithMatches = tokens.map(tok => ({ token: tok.token, matches: identifyToken(tok.stripped) }));

    // disambiguate nouns by articles
    tokensWithMatches = disambiguate(tokensWithMatches);

    // produce output using original tokens but bracket those with a match for the target case
    const output = tokensWithMatches.map(entry => {
      if ((entry.matches || []).some(m => m.tags[0] === kase)) {
        return `[${entry.token}]`;
      }
      return entry.token;
    });

    // rejoin
    return output.join("");
  }

  // ---------------------
  // Build quiz
  // ---------------------

  function buildQuiz(sentences) {
    const quiz = [];
    sentences.forEach((s, idx) => {
      data.cases.forEach(kase => {
        const question = bracketByCase(s, kase);
        if (question != s) { // if brackets were added, then we've highlighted a case that we can ask about!
          console.log( "question", question, "||| s", s )
          quiz.push({
            question: bracketByCase(s, kase),
            answers: [kase, ...data.cases.filter( r => r != kase )],
          });
        }
      });
    });
    return quiz;
  }

  function disambiguate2(tokensWithMatches) {
    for (let x = 0; x < tokensWithMatches.length; ++x) {
      let article_word = tokensWithMatches[x];
      if (article_word.matches == undefined) continue
      // console.log( "article_word.matches", article_word.matches )
      const article_matches = article_word.matches.filter( r => r.type == "article" )
      if (article_matches.length > 0) {
        // console.log( "dis: ", article_word.token, JSON.stringify( article_matches, null, 2 ))

        // find the next noun
        for (let x2 = (x+1); x2 < tokensWithMatches.length; ++x2) {
          let noun_word = tokensWithMatches[x2];
          // console.log( JSON.stringify( noun_word, null, 2 ) )
          const noun_matches = noun_word.matches.filter( r => r.type.match( /noun$/ ) )
          // console.log( JSON.stringify( noun_word.matches, null, 2 ) )
          if (noun_matches.length > 0) {
            // get the intersection of both
            const article_set = new Set(article_matches.map(o => `${o["case"]} ${o["number"]} ${o["gender"]}`));
            const noun_set = new Set(noun_matches.map(o => `${o["case"]} ${o["number"]} ${o["gender"]}`));
            const intersection_nouns = noun_matches.filter(o => article_set.has(`${o["case"]} ${o["number"]} ${o["gender"]}`));
            const intersection_articles = article_matches.filter(o => noun_set.has(`${o["case"]} ${o["number"]} ${o["gender"]}`));
            if (intersection_articles.length > 0 && intersection_nouns.length > 0) {
              // console.log( "intersection_nouns", intersection_nouns )
              // console.log( "intersection_articles", intersection_articles )
              
              // console.log( "noun_word", noun_word.matches )
              // console.log( "article_word", article_word.matches )
              noun_word.matches = [ ...noun_word.matches.filter( r => !r.type.match( /noun$/ ) ), ...intersection_nouns ];
              article_word.matches = [ ...article_word.matches.filter( r => r.type != "article" ), ...intersection_articles ];
            }
          }
        }
      }
    }
    return tokensWithMatches;
  }

  const caseOrder = {
    NOMINATIVE: 0,
    GENITIVE: 1,
    DATIVE: 2,
    ACCUSATIVE: 3,
    VOCATIVE: 4
  };

  // Step 1: Split tokens into groups
  function groupTokens(tokens, mode = "before") {
    const groups = [];
    let currentGroup = [];

    for (const token of tokens) {
      const hasCase = token.matches.some(m => m.case);
      if (hasCase) {
        if (mode === "before") {
          if (currentGroup.length) {
            groups.push([...currentGroup, token]);
            currentGroup = [];
          } else {
            groups.push([token]);
          }
        } else if (mode === "after") {
          groups.push([token, ...currentGroup]);
          currentGroup = [];
        }
      } else {
        currentGroup.push(token);
      }
    }

    if (currentGroup.length) {
      groups.push(currentGroup);
    }

    return groups;
  }


  // Step 2: Assign sort key to each group
  function getGroupSortKey(group) {
    // If group has a case-bearing token, return its order
    const caseToken = group.find(t => t.matches.some(m => m.case));
    if (caseToken) {
      const c = caseToken.matches.find(m => m.case)?.case;
      return caseOrder[c] ?? 999; // fallback if weird
    }
    // If no case at all (like trailing whitespace), push to end
    return 9999;
  }

  // Step 3: Sort groups
  function sortTokensByCase(tokens) {
    const groups = groupTokens(tokens);
    groups.sort((a, b) => getGroupSortKey(a) - getGroupSortKey(b));
    return groups.flat();
  }


  function annotate( sentence ) {
    const tokens = tokenize( sentence );
    // map tokens to objects that contain matches
    let tokensWithMatches = tokens.map(tok => {
      const ident = identifyToken(tok);
      return { token: normalize( tok ), token_original: tok, token_stripped: stripDiacriticsLeaveBreathingMarks( tok ), match_vocab: ident.find( r => r.type == "vocab" ), matches: ident.filter( r => r.type != "vocab" ) }
    });

    // disambiguate nouns by articles
    tokensWithMatches = disambiguate2(tokensWithMatches);
    tokensWithMatches = sortTokensByCase( tokensWithMatches );

    // status
    console.log( "original sentence:     ", sentence )
    console.log( "reconstructed sentence:", tokensWithMatches.filter( r => r.matches.length > 0 && r.matches[0].type != "whitespace" ).map( r => r.token ).join( " " ) );
    function renderVocab( r ) {
      let r2 = r.match_vocab;
      if (r2) {
        return `${r2?.stem}${r2?.ending ? "-" + r2?.ending : ''} \"${r2?.vocab.part_of_speech}\" ${r2?.vocab.meaning} ${r2?.vocab.gender != undefined ? r2?.vocab.gender : ''} ${r2?.vocab.hints?.declension != undefined ? r2?.vocab.hints?.declension : ''}`
      } else
        return "unknown"
    }
    tokensWithMatches.filter( a => (a.matches.length > 0 && a.matches[0].type != "whitespace") || a.matches.length == 0 ).forEach( r => {
      console.log( ` - ${r.token}\t\t\t(${renderVocab(r)}, ${r.matches.length == 0 ? "unknown" :
        r.matches.map( r2 => {
          return r2.type == "whitespace" ? r2.type :
            `${r2.type} ${r2["case"]} ${r2.gender} ${r2["number"]} ${r2["declension"] ? r2["declension"] : ''}`
        }).join(" | ")})`
      )
    })

    return tokensWithMatches
  }

  // ---------------------
  // Example run
  // ---------------------

  const sentences = [
    // "ὁ Ὅμηρος τὸν ἄνθρωπον παιδεύει.",
    // "ὁ Ὁμήρου ἀδελφὸς παιδεύει τὸν ἄνθρωπον.",
    // "τὸν Ὅμηρον παιδεύει ὁ ἄνθρωπος.",
    "τὰ τῶν θεῶν δῶρα πέμπει ὁ τοῦ ἀνθρώπου ἀδελφὸς ἐκ τῆς οἰκίας εἰς τὰς νήσους.",
    "ὁ ἐν τῇ νήσῳ ἄνθρωπος τοὺς ἀδελφοὺς εἰς μάχην πέμπει.",
    "ὁ ἀδελφὸς ὁ Ὁμήρου βιβλίον ἐκ τῆς ἀγορᾶς εἰς τὴν νῆσον πέμπει.",
  ];

  console.log( 'annotate', JSON.stringify( annotate(sentences[0]), null, 2 ) );
  // console.log( 'NOMINATIVE', bracketByCase(sentences[0], 'NOMINATIVE') );
  // console.log( 'GENETIVE', bracketByCase(sentences[0], 'GENETIVE') );
  // console.log( 'DATIVE', bracketByCase(sentences[0], 'DATIVE') );
  // console.log( 'ACCUSATIVE', bracketByCase(sentences[0], 'ACCUSATIVE') );
  // console.log( 'VOCATIVE', bracketByCase(sentences[0], 'VOCATIVE') );
  // console.log(JSON.stringify(buildQuiz(sentences), null, 2));
}

// blah( require(`${settings.WIKI_DIR}/greek-units.json`) )

function generateNounDeclenionQuizData(declensionData, branch = "first", options = {}) {
  const branchData = declensionData[branch];
  if (!branchData) throw new Error(`No declension branch found for '${branch}'`);

  const caseOrder = ["NOMINATIVE", "GENITIVE", "DATIVE", "ACCUSATIVE", "VOCATIVE"];
  const numberOrder = ["singular", "plural"];

  const quizzes = [];

  for (const gender of Object.keys(branchData)) {
    const genderData = branchData[gender];

    for (const number of numberOrder) {
      if (!genderData[number]) continue;

      for (const caseName of caseOrder) {
        const correct = genderData[number][caseName];
        if (!correct) continue;

        // Create detractors by shuffling slightly
        const detractors = Object.values(genderData[number])
          .filter(ending => ending !== correct);

        // Guarantee at least 3 detractors
        // while (detractors.length < 3) {
        //   detractors.push(correct); // pad if needed
        // }

        const answers = [correct, ...detractors.slice(0, 3)].map( r => options?.[gender] ? (stripDiacriticsLeaveBreathingMarks( options?.[gender] ) + r.replace( /^-/, "" )) : r );

        quizzes.push({
          question: `${branch} declension: ${gender}, ${number}, ${caseName}`,
          answers
        });
      }
    }
  }

  return quizzes;
}




app_name = "quizzes"
apps.push( app_name )
module.exports["buildPage_" + app_name] = (req, app_name) => {
  const greek_roots = loadDataJSON( './wiki/greek-roots.json', "[ { \"root\": \"ἔχιδν-\" }, { \"root\": \"χρ-\" } ]" )
  const greek_roots_dedupe = dedupe(greek_roots, "root")

  let data = ""

  // Introduction
  
  data += `<script type="application/json">` + JSON.stringify({
    options: { inorder: true, first_question: 0 },
    title: "Intro: Alphabet In order letters (name)",
    questions: require(`${settings.WIKI_DIR}/greek-alpha.json`).filter( r => true ).map( (r, i, arr) => { return { "question": `What's next after ${r.name}`, "answer": arr[(i + 1) % arr.length].name }})
  }) + `</script>` + '\n'
  data += `<script type="application/json">` + JSON.stringify({
    options: { inorder: true, first_question: 0 },
    title: "Intro: Alphabet In order letters (lowercase)",
    questions: require(`${settings.WIKI_DIR}/greek-alpha.json`).filter( r => true ).map( (r, i, arr) => { return { "question": `What's next after ${r.scroll}`, "answer": arr[(i + 1) % arr.length].scroll }})
  }) + `</script>` + '\n'
  data += `<script type="application/json">` + JSON.stringify({
    options: { inorder: true, first_question: 0 },
    title: "Intro: Alphabet In order letters (uppercase)",
    questions: require(`${settings.WIKI_DIR}/greek-alpha.json`).filter( r => true ).map( (r, i, arr) => { return { "question": `What's next after ${r.stone}`, "answer": arr[(i + 1) % arr.length].scroll }})
  }) + `</script>` + '\n' + '\n'

  data += `<script type="application/json">` + JSON.stringify({
    title: "Intro: Alphabet Letter to sound (name)",
    questions: require(`${settings.WIKI_DIR}/greek-alpha.json`).filter( r => true ).map( (r, i, arr) => { return { "question": `What sound does ${r.name} make`, "answer": r.sound }})
  }) + `</script>` + '\n'
  data += `<script type="application/json">` + JSON.stringify({
    title: "Intro: Alphabet Letter to sound (lowercase)",
    questions: require(`${settings.WIKI_DIR}/greek-alpha.json`).filter( r => true ).map( (r, i, arr) => { return { "question": `What sound does ${r.scroll} make`, "answer": r.sound }})
  }) + `</script>` + '\n'
  data += `<script type="application/json">` + JSON.stringify({
    title: "Intro: Alphabet Letter to sound (uppercase)",
    questions: require(`${settings.WIKI_DIR}/greek-alpha.json`).filter( r => true ).map( (r, i, arr) => { return { "question": `What sound does ${r.stone} make`, "answer": r.sound }})
  }) + `</script>` + '\n'

  data += `<script type="application/json">` + JSON.stringify({
    title: "Intro: Alphabet Letter to Name (lowercase)",
    questions: require(`${settings.WIKI_DIR}/greek-alpha.json`).filter( r => true ).map( r => { return { "question": r.scroll, "answer": r.name }})
  }) + `</script>` + '\n'
  data += `<script type="application/json">` + JSON.stringify({
    title: "Intro: Alphabet Letter to Name (uppercase)",
    questions: require(`${settings.WIKI_DIR}/greek-alpha.json`).filter( r => true ).map( r => { return { "question": r.stone, "answer": r.name }})
  }) + `</script>` + '\n'

  data += `<script type="application/json">` + JSON.stringify({
    title: "Intro: Alphabet Uppercase to Lowercase",
    questions: require(`${settings.WIKI_DIR}/greek-alpha.json`).filter( r => true ).map( r => { return { "question": r.stone, "answer": r.scroll }})
  }) + `</script>`

  data += `<script type="application/json">` + JSON.stringify({
    title: "Intro: Alphabet Letter to Pronunciation (lowercase)",
    questions: require(`${settings.WIKI_DIR}/greek-alpha.json`).filter( r => true ).map( (r, i, arr) => { return { "question": `Pronounce ${r.scroll}`, "answers": [r.name_pronunciation, ...r.name_pronunciation_wrong.sort(() => Math.random() - 0.5)] }})
  }) + `</script>` + '\n'
  data += `<script type="application/json">` + JSON.stringify({
    title: "Intro: Alphabet Letter to Pronunciation (uppercase)",
    questions: require(`${settings.WIKI_DIR}/greek-alpha.json`).filter( r => true ).map( (r, i, arr) => { return { "question": `Pronounce ${r.stone}`, "answers": [r.name_pronunciation, ...r.name_pronunciation_wrong.sort(() => Math.random() - 0.5)] }})
  }) + `</script>` + '\n'

  data += `<script type="application/json">` + JSON.stringify({
    title: "Intro: Alphabet Out of Order letters (names)",
    questions: require(`${settings.WIKI_DIR}/greek-alpha.json`).filter( r => true ).map( (r, i, arr) => { return { "question": `What's next after ${r.name}`, "answer": arr[(i + 1) % arr.length].name }})
  }) + `</script>` + '\n'
  data += `<script type="application/json">` + JSON.stringify({
    title: "Intro: Alphabet Out of Order letters (uppercase)",
    questions: require(`${settings.WIKI_DIR}/greek-alpha.json`).filter( r => true ).map( (r, i, arr) => { return { "question": `What's next after ${r.stone}`, "answer": arr[(i + 1) % arr.length].stone }})
  }) + `</script>` + '\n'
  data += `<script type="application/json">` + JSON.stringify({
    title: "Intro: Alphabet Out of Order letters (lowercase)",
    questions: require(`${settings.WIKI_DIR}/greek-alpha.json`).filter( r => true ).map( (r, i, arr) => { return { "question": `What's next after ${r.scroll}`, "answer": arr[(i + 1) % arr.length].scroll }})
  }) + `</script>` + '\n'

  // Intro
  data += `<script type="application/json">` + JSON.stringify({
    title: "Intro: Breathing Marks",
    questions: [
      { "question": "what accent mark is ἁ", "answers": ["heavy breathing", "smooth breathing", "vocal pitch up", "vocal pitch down"] },
      { "question": "what accent mark is ἀ", "answers": ["smooth breathing", "heavy breathing", "vocal pitch up", "vocal pitch down"] },
      { "question": "what accent mark is ά", "answers": ["vocal pitch up", "vocal pitch down", "heavy breathing", "smooth breathing"] },
      { "question": "what accent mark is ὰ", "answers": ["vocal pitch down", "heavy breathing", "smooth breathing", "vocal pitch up"] },
      { "question": "What two letters always gets heavy breathing?", "answers": ["ῤ ὐ", "ἐ ἠ", "ἀ ὀ", "ῤ ἰ"] },
    ]
  }) + `</script>` + '\n'
  data += `<script type="application/json">` + JSON.stringify({
    "title": "Intro: Dipthongs",
    "question": "Select the correct sound for the dipthong...",
    "questions": [
      {"question":"αι","answer":"like 'eye'"},
      {"question":"ει","answer":"like 'ay' (as in 'bay')"},
      {"question":"οι","answer":"like 'oy' (as in 'boy')"},
      {"question":"υι","answer":"like 'wih' (as in 'wit')"},
      {"question":"αυ","answer":"like 'ow' (as in 'cow')"},
      {"question":"ευ","answer":"like 'eh-oo'"},
      {"question":"ηυ","answer":"like 'ee-oo'"},
      {"question":"ου","answer":"like 'oo' (as in 'food')"}
    ]
  }) + `</script>` + '\n'
  data += `<script type="application/json">` + JSON.stringify({
    "title": "Intro: Iota Subscript/Adscript (unpronounced)",
    "question": "Select the correct sound for the Iota Subscript/Adscript...",
    "questions": [
      {"question":"ᾳ","answer":"subscript - ah (father)"},
      {"question":"ῃ","answer":"subscript - ay (day)"},
      {"question":"ῳ","answer":"subscript - ou (flow)"},
      {"question":"Αι","answer":"adscript - ah (father)"},
      {"question":"Ηι","answer":"adscript - ay (day)"},
      {"question":"Ωι","answer":"adscript - ou (flow)"},
    ]
  }) + `</script>` + '\n'
  data += `<script type="application/json">` + JSON.stringify({
    "title": "Intro: Iota Subscript/Adscript (pronounced)",
    "question": "Select the correct sound for the Iota Subscript/Adscript...",
    "questions": [
      {"question":"ᾳ","answer":"subscript - eye"},
      {"question":"ῃ","answer":"subscript - ayee"},
      {"question":"ῳ","answer":"subscript - oy"},
      {"question":"Αι","answer":"adscript - eye"},
      {"question":"Ηι","answer":"adscript - ayee"},
      {"question":"Ωι","answer":"adscript - oy"},
    ]
  }) + `</script>` + '\n'
  data += `<script type="application/json">` + JSON.stringify({
    title: "Intro: Gamma Combos",
    question: "what sound does this make",
    questions: [
      { "question": "γγ", "answer": "a[ng]er" },
      { "question": "γκ", "answer": "ba[nk]er" },
      { "question": "γξ", "answer": "sphi[nx]" },
      { "question": "γχ", "answer": "lu[nkh]ead" },
    ]
  }) + `</script>` + '\n'
  data += `<script type="application/json">` + JSON.stringify({
    title: "Intro: Pronunciation Drill 1",
    question: "For these Pronunciation Drills, pronounce any syllable with an accent mark ('`~) with a slight stress",
    questions: require(`${settings.WIKI_DIR}/greek-units.json`)["Intro"]["pronunciation"]["I"]
  }) + `</script>` + '\n'
  data += `<script type="application/json">` + JSON.stringify({
    title: "Intro: Pronunciation Drill 2",
    question: "For these Pronunciation Drills, pronounce any syllable with an accent mark ('`~) with a slight stress",
    questions: require(`${settings.WIKI_DIR}/greek-units.json`)["Intro"]["pronunciation"]["II"]
  }) + `</script>` + '\n'
  data += `<script type="application/json">` + JSON.stringify({
    title: "Intro: Pronunciation Drill 3",
    question: "For these Pronunciation Drills, pronounce any syllable with an accent mark ('`~) with a slight stress",
    questions: require(`${settings.WIKI_DIR}/greek-units.json`)["Intro"]["pronunciation"]["III"]
  }) + `</script>` + '\n'

  // Unit 1
  data += require(`${settings.WIKI_DIR}/greek-units.json`)["unit1"]["quizzes"].map( r => `<script type="application/json">` + JSON.stringify(r) + `</script>` ).join( "\n" ) + '\n';
  data += `<script type="application/json">` + JSON.stringify({
    "options": { "inorder": true, "first_question": 0 },
    title: "Unit1: THE definite article Declensions",
    question: "THE definite article",
    questions: generateDefiniteArticleQuiz( require(`${settings.WIKI_DIR}/greek-units.json`)["definite article declension"] )
  }) + `</script>` + '\n'
  data += `<script type="application/json">` + JSON.stringify({
    "options": { "inorder": true, "first_question": 0 },
    title: "Unit1: 1st declension noun endings",
    question: "Unit1: 1st declension noun endings",
    questions: generateNounDeclenionQuizData( require(`${settings.WIKI_DIR}/greek-units.json`)["noun declension"], "first" )
  }) + `</script>` + '\n'
  data += `<script type="application/json">` + JSON.stringify({
    "options": { "inorder": true, "first_question": 0 },
    title: "Unit1: 2nd declension noun endings",
    question: "Unit1: 2nd declension noun endings",
    questions: generateNounDeclenionQuizData( require(`${settings.WIKI_DIR}/greek-units.json`)["noun declension"], "second" )
  }) + `</script>` + '\n'

  data += `<script type="application/json">` + JSON.stringify({
    "options": { "inorder": true, "first_question": 0 },
    title: "Unit1: 1st declension nouns",
    question: "Unit1: 1st declension nouns",
    questions: generateNounDeclenionQuizData( require(`${settings.WIKI_DIR}/greek-units.json`)["noun declension"], "first", { "feminine": "τέχν", "feminine (ends in ε,ι,ρ)": "χώρ" } )
  }) + `</script>` + '\n'
  data += `<script type="application/json">` + JSON.stringify({
    "options": { "inorder": true, "first_question": 0 },
    title: "Unit1: 2nd declension nouns",
    question: "Unit1: 2nd declension nouns",
    questions: generateNounDeclenionQuizData( require(`${settings.WIKI_DIR}/greek-units.json`)["noun declension"], "second", { "masculine/feminine": "λόγ", "neuter": "ἔργ" } )
  }) + `</script>` + '\n'
  data += `<script type="application/json">` + JSON.stringify({
    title: "Unit1: Vocab Meanings",
    questions: require(`${settings.WIKI_DIR}/greek-units.json`)["unit1"]["vocab_stems"].filter( r => true ).map( r => { return { "question": r.root, "answer": r.meaning }})
  }) + `</script>` + '\n'
  data += `<script type="application/json">` + JSON.stringify({
    title: "Unit1: Vocab Declensions",
    questions: require(`${settings.WIKI_DIR}/greek-units.json`)["unit1"]["vocab_stems"].filter( r => r.part_of_speech == "noun" || r.part_of_speech == "proper noun" ).map( r => {
      let cases = ["NOMINATIVE", "GENITIVE", "DATIVE", "ACCUSATIVE", "VOCATIVE"];
      let c = cases[Math.floor(Math.random() * cases.length)];
      cases = cases.filter(r => r !== c);
      let numbers = ["plural","singular"];
      let number = numbers[Math.floor(Math.random() * numbers.length)];
      return { "question": `${r.root} (${r.meaning}) is a ${r.hints.declension} declension, ${r.gender} ${r.part_of_speech}, choose the ${c} ${number} case below`, "answers": [ declineNoun( r, c, number ), ...cases.map( c => declineNoun( r, c, number ) ) ] }})
  }) + `</script>` + '\n'

  data += `<script type="application/json">` + JSON.stringify({
    title: "Word Roots - Nouns",
    questions: greek_roots_dedupe.filter( r => r.part_of_speech == "noun" ).map( r => { return { "question": r.root, "answer": r.meaning }})
  }) + `</script>` + '\n'
  data += `<script type="application/json">` + JSON.stringify({
    title: "Word Roots - Verbs",
    questions: greek_roots_dedupe.filter( r => r.part_of_speech == "verb" ).map( r => { return { "question": r.root, "answer": r.meaning }})
  }) + `</script>` + '\n'
  data += `<script type="application/json">` + JSON.stringify({
    title: "Word Roots - Adjective",
    questions: greek_roots_dedupe.filter( r => r.part_of_speech == "adjective" ).map( r => { return { "question": r.root, "answer": r.meaning }})
  }) + `</script>` + '\n'
  data += `<script type="application/json">` + JSON.stringify({
    title: "Word Roots - Prefixes",
    questions: greek_roots_dedupe.filter( r => r.part_of_speech == "prefix" ).map( r => { return { "question": r.root, "answer": r.meaning }})
  }) + `</script>` + '\n'
  data += `<script type="application/json">` + JSON.stringify({
    title: "Word Roots - Proper Noun",
    questions: greek_roots_dedupe.filter( r => r.part_of_speech == "proper noun" ).map( r => { return { "question": r.root, "answer": r.meaning }})
  }) + `</script>` + '\n'
  data += `<script type="application/json">` + JSON.stringify({
    title: "Word Roots - Root to Word",
    questions: greek_roots_dedupe.filter( r => true ).map( r => { return { "question": r.root, "answer": transliterateGreek( r.example_words.join( ", ") ) }})
  }) + `</script>` + '\n'
  data += `<script type="application/json">` + JSON.stringify({
    title: "Word Roots - Transliterate Root to English",
    questions: greek_roots_dedupe.filter( r => true ).map( r => { return { "question": r.root, "answer": transliterateGreek( r.root ) }})
  }) + `</script>` + '\n'
  data += `<script type="application/json">` + JSON.stringify({
    title: "Word Roots - Transliterate Root-Words to English",
    questions: greek_roots_dedupe.filter( r => true ).map( r => { return { "question": r.example_words.join( ", "), "answer": transliterateGreek( r.example_words.join(", ") ) }})
  }) + `</script>` + '\n'


  const protocol = req.protocol;               // 'http' or 'https'
  const host = req.get('host');                // example.com or example.com:3000
  const domain = `${protocol}://${host}`;
  const pageHTML = template.file( "template.page.html", {
    ...commonPageVars(req, app_name),
    CANONICAL_URL_ROOT: domain,
    BODY: template.file( "template.quiz.html", {
      ...commonPageVars(req, app_name),
      SCRIPTS: `<%include "${settings.WIKI_DIR}/greek-quizes.json" force%>${data}`
    })
  })
  return pageHTML;
}
router.get(`/${app_name}`, (req, res) => {
  const app_name = req.route.path.replace(/^\//, '');
  try {
    console.log( `[greek] ${userLogDisplay(req)} ${req.baseUrl}/${app_name}` )
    const pageHTML = module.exports["buildPage_" + app_name]( req, app_name );
    return res.send( pageHTML );
  } catch (err) {
    return res.send(generateCatchHTML(err));
  }
});


function generateDataEndPoints( gen_name = "roots", gen_key = "root", gen_datafile = './wiki/greek-roots.json' ) {
  app_name = `list_all_${gen_name}_table`
  apps.push( app_name )
  router.get(`/${app_name}`, (req, res) => {
    const app_name = req.route.path.replace(/^\//, '');
    try {
      console.log( `[greek] ${userLogDisplay(req)} ${req.baseUrl}/${app_name}` )
      const new_roots = loadDataJSON( gen_datafile, "[ { \"root\": \"ἔχιδν-\" }, { \"root\": \"χρ-\" } ]" )

      // just retrieve the table cell data...
      function cellContents(r, key) {
        return r[key] ? (typeof r[key] == 'object') ? (Array.isArray( r[key] ) ? r[key].join(", ") : JSON.stringify( r[key] )) : r[key] : ''
      }

      const headings = Object.keys( new_roots[0] );
      let str = `|${headings.map( key => ` ${key} |` ).join("")}\n`
      str += `|${headings.map( key => `:-----|` ).join("")}\n`
      str += `${new_roots.map( r => {return "|" + headings.map( key => ` ${cellContents(r, key).replace(/\|/g,"&vert;")} |` ).join("")} ).join("\n")}\n`

      return res.send(
        template.file( "template.page.html", {
          ...commonPageVars(req, app_name),
          BODY: `
            ${new_roots.length} total:<BR>
            ${markdownToHtml( str )}
          `
        })
      );
    } catch (err) {
      return res.send(generateCatchHTML(err));
    }
  });


  app_name = `list_all_${gen_name}_json`
  apps.push( app_name )
  router.get(`/${app_name}`, (req, res) => {
    const app_name = req.route.path.replace(/^\//, '');
    try {
      console.log( `[greek] ${userLogDisplay(req)} ${req.baseUrl}/${app_name}` )
      const new_roots = loadDataJSON( gen_datafile, "[ { \"root\": \"ἔχιδν-\" }, { \"root\": \"χρ-\" } ]" )
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

  app_name = `list_all_${gen_name}_brief`
  apps.push( app_name )
  router.get(`/${app_name}`, (req, res) => {
    const app_name = req.route.path.replace(/^\//, '');
    try {
      console.log( `[greek] ${userLogDisplay(req)} ${req.baseUrl}/${app_name}` )
      const new_roots = dedupe( loadDataJSON( gen_datafile, "[ { \"root\": \"ἔχιδν-\" }, { \"root\": \"χρ-\" } ]" ), gen_key );
      let str_roots = new_roots.map( r => r[gen_key] ).join(", ");
      return res.send(
        template.file( "template.page.html", {
          ...commonPageVars(req, app_name),
          BODY: `
            ${new_roots.length} unique entries:<BR>
            ${str_roots}
          `
        })
      )
    } catch (err) {
      return res.send(generateCatchHTML(err));
    }
  });
}

generateDataEndPoints( "roots", "root", './wiki/greek-roots.json' );
generateDataEndPoints( "alpha", "name", './wiki/greek-alpha.json' );


/*



1. Alphabet Quiz

Goal: letter recognition, name, sound.
Formats:
Match sound to letter: play audio (or write “/ph/”), show four letters → φ / π / θ / β.

Identify name: show symbol “ξ” → options: xi / chi / zeta / ksi.

Order game: show scrambled α β δ γ, ask: “Which comes 3rd?”

2. Diphthong & Vowel Length Quiz

Goal: distinguish vowel qualities, short vs. long, diphthongs.

Formats:

Sound recognition (with audio): play sound /ai/ → choose αι / ει / οι / αυ.

Length drill: show “ο” vs “ω” → ask: which is long?

Fill-the-blank: show “λ___γος” with options ο / ω.

Trap questions: e.g. “Which of these is a true diphthong?” (ει, ου, η, ω).

3. Accent Marks Quiz

Goal: train awareness of acute, grave, circumflex, and breathing marks.

Formats:

Identify function: show: ἄνθρωπος → ask: what does the ἄ mark indicate?
Options: acute accent, rough breathing, circumflex, grave.

Match mark to rule:

Show: ῥ → options: initial rho is aspirated / initial rho is smooth / circumflex accent / iota subscript.

Error spotting: show: ὀίκος → ask: what’s wrong with the accents/breathings?

4. Audio + Accent Reinforcement (advanced)

If you add sound, you can quiz: “How would this accent shift the pitch/stress?” and have user pick the correct audio playback.
*/


//////////////////////////////////////////


function init( l ) {
  logger = l;
}

// Plug into Express
module.exports.router = router;
module.exports.init = init;
