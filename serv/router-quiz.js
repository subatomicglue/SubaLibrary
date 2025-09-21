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
          answers: [correct, ...wrongAnswers]
        });
      }
    }
  }

  return quiz;
}


app_name = "quizzes"
apps.push( app_name )
module.exports["buildPage_" + app_name] = (req, app_name) => {
  const greek_roots = loadDataJSON( './wiki/greek-roots.json', "[ { \"root\": \"ἔχιδν-\" }, { \"root\": \"χρ-\" } ]" )
  const greek_roots_dedupe = dedupe(greek_roots, "root")

  let data = ""

  // Introduction
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
    "options": { "inorder": true, "first_question": 0 },
    title: "Unit1: THE definite article Declensions",
    question: "THE definite article",
    questions: generateDefiniteArticleQuiz( require(`${settings.WIKI_DIR}/greek-units.json`)["definite article declension"] )
  }) + `</script>` + '\n'

  data += `<script type="application/json">` + JSON.stringify({
    options: { inorder: true, first_question: 0 },
    title: "Alphabet: In order letters (name)",
    questions: require(`${settings.WIKI_DIR}/greek-alpha.json`).filter( r => true ).map( (r, i, arr) => { return { "question": `What's next after ${r.name}`, "answer": arr[(i + 1) % arr.length].name }})
  }) + `</script>` + '\n'
  data += `<script type="application/json">` + JSON.stringify({
    options: { inorder: true, first_question: 0 },
    title: "Alphabet: In order letters (lowercase)",
    questions: require(`${settings.WIKI_DIR}/greek-alpha.json`).filter( r => true ).map( (r, i, arr) => { return { "question": `What's next after ${r.scroll}`, "answer": arr[(i + 1) % arr.length].scroll }})
  }) + `</script>` + '\n'
  data += `<script type="application/json">` + JSON.stringify({
    options: { inorder: true, first_question: 0 },
    title: "Alphabet: In order letters (uppercase)",
    questions: require(`${settings.WIKI_DIR}/greek-alpha.json`).filter( r => true ).map( (r, i, arr) => { return { "question": `What's next after ${r.stone}`, "answer": arr[(i + 1) % arr.length].scroll }})
  }) + `</script>` + '\n' + '\n'

  data += `<script type="application/json">` + JSON.stringify({
    title: "Alphabet: Letter to sound (name)",
    questions: require(`${settings.WIKI_DIR}/greek-alpha.json`).filter( r => true ).map( (r, i, arr) => { return { "question": `What sound does ${r.name} make`, "answer": r.sound }})
  }) + `</script>` + '\n'
  data += `<script type="application/json">` + JSON.stringify({
    title: "Alphabet: Letter to sound (lowercase)",
    questions: require(`${settings.WIKI_DIR}/greek-alpha.json`).filter( r => true ).map( (r, i, arr) => { return { "question": `What sound does ${r.scroll} make`, "answer": r.sound }})
  }) + `</script>` + '\n'
  data += `<script type="application/json">` + JSON.stringify({
    title: "Alphabet: Letter to sound (uppercase)",
    questions: require(`${settings.WIKI_DIR}/greek-alpha.json`).filter( r => true ).map( (r, i, arr) => { return { "question": `What sound does ${r.stone} make`, "answer": r.sound }})
  }) + `</script>` + '\n'

  data += `<script type="application/json">` + JSON.stringify({
    title: "Alphabet: Letter to Name (lowercase)",
    questions: require(`${settings.WIKI_DIR}/greek-alpha.json`).filter( r => true ).map( r => { return { "question": r.scroll, "answer": r.name }})
  }) + `</script>` + '\n'
  data += `<script type="application/json">` + JSON.stringify({
    title: "Alphabet: Letter to Name (uppercase)",
    questions: require(`${settings.WIKI_DIR}/greek-alpha.json`).filter( r => true ).map( r => { return { "question": r.stone, "answer": r.name }})
  }) + `</script>` + '\n'

  data += `<script type="application/json">` + JSON.stringify({
    title: "Alphabet: Uppercase to Lowercase",
    questions: require(`${settings.WIKI_DIR}/greek-alpha.json`).filter( r => true ).map( r => { return { "question": r.stone, "answer": r.scroll }})
  }) + `</script>`

  data += `<script type="application/json">` + JSON.stringify({
    title: "Alphabet: Letter to Pronunciation (lowercase)",
    questions: require(`${settings.WIKI_DIR}/greek-alpha.json`).filter( r => true ).map( (r, i, arr) => { return { "question": `Pronounce ${r.scroll}`, "answers": [r.name_pronunciation, ...r.name_pronunciation_wrong.sort(() => Math.random() - 0.5)] }})
  }) + `</script>` + '\n'
  data += `<script type="application/json">` + JSON.stringify({
    title: "Alphabet: Letter to Pronunciation (uppercase)",
    questions: require(`${settings.WIKI_DIR}/greek-alpha.json`).filter( r => true ).map( (r, i, arr) => { return { "question": `Pronounce ${r.stone}`, "answers": [r.name_pronunciation, ...r.name_pronunciation_wrong.sort(() => Math.random() - 0.5)] }})
  }) + `</script>` + '\n'

  data += `<script type="application/json">` + JSON.stringify({
    title: "Alphabet: Out of Order letters (names)",
    questions: require(`${settings.WIKI_DIR}/greek-alpha.json`).filter( r => true ).map( (r, i, arr) => { return { "question": `What's next after ${r.name}`, "answer": arr[(i + 1) % arr.length].name }})
  }) + `</script>` + '\n'
  data += `<script type="application/json">` + JSON.stringify({
    title: "Alphabet: Out of Order letters (uppercase)",
    questions: require(`${settings.WIKI_DIR}/greek-alpha.json`).filter( r => true ).map( (r, i, arr) => { return { "question": `What's next after ${r.stone}`, "answer": arr[(i + 1) % arr.length].stone }})
  }) + `</script>` + '\n'
  data += `<script type="application/json">` + JSON.stringify({
    title: "Alphabet: Out of Order letters (lowercase)",
    questions: require(`${settings.WIKI_DIR}/greek-alpha.json`).filter( r => true ).map( (r, i, arr) => { return { "question": `What's next after ${r.scroll}`, "answer": arr[(i + 1) % arr.length].scroll }})
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
