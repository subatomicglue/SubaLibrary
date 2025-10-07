const { markdownToHtml, htmlToMarkdown, splitTopicQueryHash } = require('./markdown')

// ==================== MARKDOWN TESTING ==============================================================================

// HTML testing
// let txt = ``
// console.log( "htmlToMarkdown ===============" )
// console.log( txt )
// console.log( htmlToMarkdown( txt ) );
// console.log( "htmlToMarkdown done===========" )
// console.log( "htmlToMarkdown ===============" )
// console.log( markdownToHtml(htmlToMarkdown( txt ), "/wiki") );
// console.log( "htmlToMarkdown done===========" )

// markdown testing
// let txt = `
// `
// console.log( txt )
// console.log( "htmlToMarkdown ===============" )
// console.log( markdownToHtml(txt, "/wiki") );
// console.log( "htmlToMarkdown done===========" )

function isBrowser() {
  return typeof window !== "undefined";
}
function markdownToHtmlTest(markdown, expectedHTML) {
  const html = markdownToHtml( markdown, "/base", { userdata: { "testuser": { "id": "12345" } } } )
  if (html != expectedHTML) {
    console.log( "[markdown.js] test failed" )
    console.log( "-------markdown-------" )
    console.log( markdown )
    console.log( "-------Generated HTML-------" )
    console.log( `'${html}'` )
    console.log( "-------Expected HTML-------" )
    console.log( `${expectedHTML}` )
    return false;
  }
  return true;
}
function htmlToMarkdownTest(html, expectedMarkdown) {
  const markdown = htmlToMarkdown( html )
  if (markdown != expectedMarkdown) {
    console.log( "[markdown.js] test failed" )
    console.log( "-------html-------" )
    console.log( html )
    console.log( "-------Generated markdown-------" )
    console.log( `'${markdown}'` )
    console.log( "-------Expected Markdown-------" )
    console.log( `'${expectedMarkdown}'` )
    return false;
  }
  return true;
}

if (!isBrowser()) {

markdownToHtmlTest( `# Heading`, `<h1 id="Heading">Heading<a title="Permalink to this heading" href="#Heading"><span class="copy-icon" role="button" aria-label="Link Icon"></span></a></h1>
` )
markdownToHtmlTest( `**word**`, `<b>word</b>` )
markdownToHtmlTest( `*word*`,   `<i>word</i>` )
markdownToHtmlTest( `__word__`, `<u>word</u>` )
markdownToHtmlTest( `---
word
---`, `<div style="border: 1px solid #ccc; padding: 1em; margin: 1em 0;">
word
</div>` )
markdownToHtmlTest( `===
word
===`, `<div style="padding: 1em; margin: 1em 0;">
word
</div>` )
markdownToHtmlTest( `### Lorem Ipsum," lorem ipsum [ [Lorem Ipsum](https://www.bok.com/reader/urn:cts:hiMan:abc0656.zyx001.1st1K-ghj1:2) ]`,
`<h3 id="Lorem-Ipsum---lorem-ipsum-[-Lorem-Ipsum-]">Lorem Ipsum," lorem ipsum [ <a href="https://www.bok.com/reader/urn:cts:hiMan:abc0656.zyx001.1st1K-ghj1:2">Lorem Ipsum</a> ]<a title="Permalink to this heading" href="#Lorem-Ipsum---lorem-ipsum-[-Lorem-Ipsum-]"><span class="copy-icon" role="button" aria-label="Link Icon"></span></a></h3>
` )
markdownToHtmlTest( `[< back](LoremIpsum)`, `<a href="/base/LoremIpsum">< back</a>` )

// paste from ChatGPT (heading and numbered list)
htmlToMarkdownTest( `<meta charset='utf-8'><h3>What it does:</h3>
<ol>
<li>
<p><strong>Sorts clipboard types</strong> so all <code>text/*</code> come first.</p>
</li>
<li>
<p><strong>Filters out</strong> any types that are image-based.</p>
</li>
<li>
<p><strong>Gets clipboard data</strong>, filters to ensure it’s a non-empty string.</p>
</li>
<li>
<p><strong>Returns</strong> the first matching string, or an empty string if nothing is found.</p>
</li>
</ol>
<p>Let me know if you'd like it to also log the types for debugging, or preserve the original type name with the data.</p>`,
`### What it does:

 1. **Sorts clipboard types** so all \`text/*\` come first.
 2. **Filters out** any types that are image-based.
 3. **Gets clipboard data**, filters to ensure it’s a non-empty string.
 4. **Returns** the first matching string, or an empty string if nothing is found.

Let me know if you'd like it to also log the types for debugging, or preserve the original type name with the data.
` )
markdownToHtmlTest( `------\n`, `<hr>\n` )

// paste from Google Doc (heading and bullets)
htmlToMarkdownTest( `<meta charset='utf-8'><meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-8149a452-7fff-8a08-3ee4-bdad800da9b1"><h1 dir="ltr" style="line-height:1.38;margin-top:20pt;margin-bottom:6pt;"><span style="font-size:20pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Books</span></h1><ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:disc;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="1"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">My Book 1</span></p></li><li dir="ltr" style="list-style-type:disc;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="1"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">My Book 2</span></p></li><li dir="ltr" style="list-style-type:disc;font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;" aria-level="1"><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;" role="presentation"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">My Book 3</span></p></li></ul></b>`,
`# Books

 - My Book 1
 - My Book 2
 - My Book 3
`);

// chatgpt table:
htmlToMarkdownTest( `<meta charset='utf-8'><h3>heading 1</h3>
<div class="_tableContainer_16hzy_1"><div tabindex="-1" class="_tableWrapper_16hzy_14 group flex w-fit flex-col-reverse"><table class="w-fit min-w-(--thread-content-width)"><thead><tr><th data-col-size="sm">Feature</th><th data-col-size="sm">Bacteria</th><th data-col-size="md">Mycelium</th></tr></thead><tbody><tr><td data-col-size="sm">Needs</td><td data-col-size="sm">Yes</td><td data-col-size="md">No</td></tr><tr><td data-col-size="sm">Maybe</td><td data-col-size="sm">Not</td><td data-col-size="md">Yes</td></tr><tr><td data-col-size="sm">Moist</td><td data-col-size="sm">Critical</td><td data-col-size="md">Important</td></tr><tr><td data-col-size="sm">Survival</td><td data-col-size="sm">Very poor</td><td data-col-size="md">Often succeeds</td></tr></tbody></table><div class="sticky end-(--thread-content-margin) h-0 self-end select-none"><div class="absolute end-0 flex items-end"><span data-state="closed"><button class="bg-token-bg-primary hover:bg-token-bg-tertiary text-token-text-secondary my-1 rounded-sm p-1 transition-opacity group-[:not(:hover):not(:focus-within)]:pointer-events-none group-[:not(:hover):not(:focus-within)]:opacity-0"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" class="icon-md-heavy"><path fill-rule="evenodd" clip-rule="evenodd" d="M7 5C7 3.34315 8.34315 2 10 2H19C20.6569 2 22 3.34315 22 5V14C22 15.6569 20.6569 17 19 17H17V19C17 20.6569 15.6569 22 14 22H5C3.34315 22 2 20.6569 2 19V10C2 8.34315 3.34315 7 5 7H7V5ZM9 7H14C15.6569 7 17 8.34315 17 10V15H19C19.5523 15 20 14.5523 20 14V5C20 4.44772 19.5523 4 19 4H10C9.44772 4 9 4.44772 9 5V7ZM5 9C4.44772 9 4 9.44772 4 10V19C4 19.5523 4.44772 20 5 20H14C14.5523 20 15 19.5523 15 19V10C15 9.44772 14.5523 9 14 9H5Z" fill="currentColor"></path></svg></button></span></div></div></div></div>
<hr>
<h3>heading 2</h3>`,
`### heading 1

| Feature | Bacteria | Mycelium |
|---|---|---|
| Needs | Yes | No |
| Maybe | Not | Yes |
| Moist | Critical | Important |
| Survival | Very poor | Often succeeds |

---------
### heading 2
`);


htmlToMarkdownTest( `<meta charset='utf-8'><h3>Heading 1</h3>
<ul>
<li>
<p>The name <strong>Aelius Gallus</strong> appears in both <strong>Dioscorides</strong> and <strong>Galen</strong>, but the <strong>style</strong> of the Greek and the presence of phrases like <strong>"Caesar agreed" (Καῖσαρ συμφώνως)</strong> and specific mention of <strong>Charmis</strong> suggest this comes from <strong>Galen</strong>, not from <strong>Dioscorides' De Materia Medica</strong>.</p>
</li>
<li>
<p>Galen frequently:</p>
<ul>
<li>
<p>Mentions antidotes (<strong>ἀντίδοτα</strong>) by name and attribution.</p>
</li>
<li>
<p>References earlier physicians like <strong>Charmis</strong>, <strong>Andromachus</strong>, and <strong>Aelius Gallus</strong>.</p>
</li>
<li>
<p>Cites <strong>imperial approval</strong> of certain compounds, especially those used by <strong>Caesar Augustus</strong>, <strong>Tiberius</strong>, or <strong>Marcus Aurelius</strong>.</p></li></ul></li></ul>`
,
`### Heading 1

 - The name **Aelius Gallus** appears in both **Dioscorides** and **Galen**, but the **style** of the Greek and the presence of phrases like **"Caesar agreed" (Καῖσαρ συμφώνως)** and specific mention of **Charmis** suggest this comes from **Galen**, not from **Dioscorides' De Materia Medica**.
 - Galen frequently:
   - Mentions antidotes (**ἀντίδοτα**) by name and attribution.
   - References earlier physicians like **Charmis**, **Andromachus**, and **Aelius Gallus**.
   - Cites **imperial approval** of certain compounds, especially those used by **Caesar Augustus**, **Tiberius**, or **Marcus Aurelius**.
`);

// paste from perseus alice https://www.perseus.tufts.edu/hopper/morph
htmlToMarkdownTest( `<div style="margin-left: 50px; "><b>II.</b>---.</div><div class="lex_sense lex_sense3" style="margin-left: 100px;"><b>2.</b>---.</div>`,
`
} **II.**---.
}} **2.**---.` )

htmlToMarkdownTest( `<blockquote>hi<blockquote>hi</blockquote></blockquote>`,
`
> hi
>> hi
` )

markdownToHtmlTest( `# Heading
text
<!-- toc-all -->

## Heading 2 [is Heading 2](some link crap)

### Heading 2.1

#### Heading 2.1.1

## Heading 3
`,
`<h1 id="Heading">Heading<a title="Permalink to this heading" href="#Heading"><span class="copy-icon" role="button" aria-label="Link Icon"></span></a></h1>
text<br>
<ul><li><a href="#Heading">Heading</a><ul><li><a href="#Heading-2-is-Heading-2">Heading 2 is Heading 2</a><ul><li><a href="#Heading-2.1">Heading 2.1</a><ul><li><a href="#Heading-2.1.1">Heading 2.1.1</a></li></ul></li></ul></li><li><a href="#Heading-3">Heading 3</a></li></ul></li></ul>
<p><h2 id="Heading-2-is-Heading-2">Heading 2 <a href="/base/some%20link%20crap">is Heading 2</a><a title="Permalink to this heading" href="#Heading-2-is-Heading-2"><span class="copy-icon" role="button" aria-label="Link Icon"></span></a></h2>
<p><h3 id="Heading-2.1">Heading 2.1<a title="Permalink to this heading" href="#Heading-2.1"><span class="copy-icon" role="button" aria-label="Link Icon"></span></a></h3>
<p><h4 id="Heading-2.1.1">Heading 2.1.1<a title="Permalink to this heading" href="#Heading-2.1.1"><span class="copy-icon" role="button" aria-label="Link Icon"></span></a></h4>
<p><h2 id="Heading-3">Heading 3<a title="Permalink to this heading" href="#Heading-3"><span class="copy-icon" role="button" aria-label="Link Icon"></span></a></h2>
`)

markdownToHtmlTest( `# Heading
text
<!-- toc -->

## Heading 2 [is Heading 2](some link crap)

### Heading 2.1

#### Heading 2.1.1

## Heading 3
`,
`<h1 id="Heading">Heading<a title="Permalink to this heading" href="#Heading"><span class="copy-icon" role="button" aria-label="Link Icon"></span></a></h1>
text<br>
<ul><li><a href="#Heading-2-is-Heading-2">Heading 2 is Heading 2</a><ul><li><a href="#Heading-2.1">Heading 2.1</a><ul><li><a href="#Heading-2.1.1">Heading 2.1.1</a></li></ul></li></ul></li><li><a href="#Heading-3">Heading 3</a></li></ul>
<p><h2 id="Heading-2-is-Heading-2">Heading 2 <a href="/base/some%20link%20crap">is Heading 2</a><a title="Permalink to this heading" href="#Heading-2-is-Heading-2"><span class="copy-icon" role="button" aria-label="Link Icon"></span></a></h2>
<p><h3 id="Heading-2.1">Heading 2.1<a title="Permalink to this heading" href="#Heading-2.1"><span class="copy-icon" role="button" aria-label="Link Icon"></span></a></h3>
<p><h4 id="Heading-2.1.1">Heading 2.1.1<a title="Permalink to this heading" href="#Heading-2.1.1"><span class="copy-icon" role="button" aria-label="Link Icon"></span></a></h4>
<p><h2 id="Heading-3">Heading 3<a title="Permalink to this heading" href="#Heading-3"><span class="copy-icon" role="button" aria-label="Link Icon"></span></a></h2>
`)

htmlToMarkdownTest( `<a href="https://www.google.com" style="text-decoration: none; color: rgb(51, 102, 204); background: none; border-radius: 2px; overflow-wrap: break-word;">[25]</a>`,
`[&lbrack;25&rbrack;](https://www.google.com)` )

markdownToHtmlTest( ` - bullet [[link](mytopic?searchterm=bokbok)]
  `,
  `<ul><li>bullet [<a href="/base/mytopic?searchterm=bokbok">link</a>]</li></ul>
  `)
markdownToHtmlTest( ` - bullet [[link](mytopic#bokbok)]
  `,
  `<ul><li>bullet [<a href="/base/mytopic#bokbok">link</a>]</li></ul>
  `)

// with preceeding space
markdownToHtmlTest( ` - bullet
 - bullet2
   - bullet3
   - bullet4
  `,
  `<ul><li>bullet</li><li>bullet2<ul><li>bullet3</li><li>bullet4</li></ul></li></ul>
  `)
markdownToHtmlTest( ` 1. bullet
 2. bullet2
   a. bullet3
   b. bullet4
  `,
  `<ol type="1" start="1"><li>bullet</li><li>bullet2<ol type="a" start="a"><li>bullet3</li><li>bullet4</li></ol></li></ol>
  `)

// without preceeding space
markdownToHtmlTest( `- bullet
- bullet2
  - bullet3
  - bullet4
  `,
  `<ul><li>bullet</li><li>bullet2<ul><li>bullet3</li><li>bullet4</li></ul></li></ul>
  `)
markdownToHtmlTest( `1. bullet
2. bullet2
  a. bullet3
  b. bullet4
  `,
  `<ol type="1" start="1"><li>bullet</li><li>bullet2<ol type="a" start="a"><li>bullet3</li><li>bullet4</li></ol></li></ol>
  `)

markdownToHtmlTest( `[title](https://www.google.com/path/to/my thing is amazing?key=value#hash)`,
  `<a href="https://www.google.com/path/to/my thing is amazing?key=value#hash">title</a>`
)

markdownToHtmlTest( `https://www.google.com/path/to/thing?key=value#hash`,
  `<a href="https://www.google.com/path/to/thing?key=value#hash">https://www.google.com/path/to/thing?key=value#hash</a>`
)

markdownToHtmlTest( `[title](/path/to/my thing is amazing)`,
  `<a href="/path/to/my%20thing%20is%20amazing">title</a>`
)
markdownToHtmlTest( `[title](/path/to/my thing is amazing#test)`,
  `<a href="/path/to/my%20thing%20is%20amazing#test">title</a>`
)
markdownToHtmlTest( `[title](/path/to/my thing is amazing?searchterm=bok#test)`,
  `<a href="/path/to/my%20thing%20is%20amazing?searchterm=bok#test">title</a>`
)
markdownToHtmlTest( `[title](my crazy wiki topic)`,
  `<a href="/base/my%20crazy%20wiki%20topic">title</a>`
)
markdownToHtmlTest( `[title](my crazy wiki topic#my bookmark is also crazy)`,
  `<a href="/base/my%20crazy%20wiki%20topic#my-bookmark-is-also-crazy">title</a>`
)
markdownToHtmlTest( `[title](my crazy wiki topic?searchterm=bok#my bookmark is also crazy)`,
  `<a href="/base/my%20crazy%20wiki%20topic?searchterm=bok#my-bookmark-is-also-crazy">title</a>`
)
markdownToHtmlTest( `[title](#my bookmark is crazy)`,
  `<a href="#my-bookmark-is-crazy">title</a>`
)
markdownToHtmlTest( `[title](?searchterm=bok#my bookmark is crazy)`,
  `<a href="?searchterm=bok#my-bookmark-is-crazy">title</a>`
)
markdownToHtmlTest( `[title](#ref with parens and umlat (Büoenn%29)`,
  `<a href="#ref-with-parens-and-umlat--B-oenn-29">title</a>`
)
markdownToHtmlTest( `<!-- toc-all -->\n# Heading with a paren (Büoenn)\n`,
  `<ul><li><a href="#Heading-with-a-paren--B-oenn-">Heading with a paren (Büoenn)</a></li></ul>
<h1 id="Heading-with-a-paren--B-oenn-">Heading with a paren (Büoenn)<a title="Permalink to this heading" href="#Heading-with-a-paren--B-oenn-"><span class="copy-icon" role="button" aria-label="Link Icon"></span></a></h1>
`
)
markdownToHtmlTest( `<!-- toc-all -->\n# Heading with 1:1 a colon\n`,
  `<ul><li><a href="#Heading-with-1:1-a-colon">Heading with 1:1 a colon</a></li></ul>
<h1 id="Heading-with-1:1-a-colon">Heading with 1:1 a colon<a title="Permalink to this heading" href="#Heading-with-1:1-a-colon"><span class="copy-icon" role="button" aria-label="Link Icon"></span></a></h1>
`
)
markdownToHtmlTest( `<!-- toc-all -->\n# Heading with , a comma\n`,
  `<ul><li><a href="#Heading-with---a-comma">Heading with , a comma</a></li></ul>
<h1 id="Heading-with---a-comma">Heading with , a comma<a title="Permalink to this heading" href="#Heading-with---a-comma"><span class="copy-icon" role="button" aria-label="Link Icon"></span></a></h1>
`
)

markdownToHtmlTest( `{{ user:12345 }}`,
  `testuser`
)

markdownToHtmlTest( `---
} **III.** some text *is here* 
---
`,
  `<div style="border: 1px solid #ccc; padding: 1em; margin: 1em 0;">
<blockquote style="border-left-color:transparent;"><b>III.</b> some text <i>is here</i></blockquote>
</div>
`)


markdownToHtmlTest( `---
} **III.** some text *is here* 
} **III.** some text *is here* 
} **III.** some text *is here* 
---
`,
  `<div style="border: 1px solid #ccc; padding: 1em; margin: 1em 0;">
<blockquote style="border-left-color:transparent;"><b>III.</b> some text <i>is here</i> <br><b>III.</b> some text <i>is here</i> <br><b>III.</b> some text <i>is here</i></blockquote>
</div>
`)

markdownToHtmlTest( `---
} **III.** some text *is here* 
}} **III.** some text *is here* 
}}} **III.** some text *is here* 
---
`,
  `<div style="border: 1px solid #ccc; padding: 1em; margin: 1em 0;">
<blockquote style="border-left-color:transparent;"><b>III.</b> some text <i>is here</i> <blockquote style="border-left-color:transparent;"><b>III.</b> some text <i>is here</i> <blockquote style="border-left-color:transparent;"><b>III.</b> some text <i>is here</i></blockquote></blockquote></blockquote>
</div>
`)

markdownToHtmlTest( `---
text
}}} **III.** some text *is here* 
text
---
`,
  `<div style="border: 1px solid #ccc; padding: 1em; margin: 1em 0;">
text<blockquote style="border-left-color:transparent;"><blockquote style="border-left-color:transparent;"><blockquote style="border-left-color:transparent;"><b>III.</b> some text <i>is here</i></blockquote></blockquote></blockquote>text
</div>
`)

markdownToHtmlTest( `---
**NOTE:** this is a box
it's a great box
---
`,
  `<div style="border: 1px solid #ccc; padding: 1em; margin: 1em 0;">
<b>NOTE:</b> this is a box<br>it's a great box
</div>
`)

markdownToHtmlTest( `---
**NOTE:** this is a box

it's a great box
---
`,
  `<div style="border: 1px solid #ccc; padding: 1em; margin: 1em 0;">
<b>NOTE:</b> this is a box<p>it's a great box
</div>
`)

markdownToHtmlTest( `---
- a bullet
---
`,
  `<div style="border: 1px solid #ccc; padding: 1em; margin: 1em 0;">
<ul><li>a bullet</li></ul>
</div>
`)

markdownToHtmlTest( `---
- a bullet
- another bullet
---
`,
  `<div style="border: 1px solid #ccc; padding: 1em; margin: 1em 0;">
<ul><li>a bullet</li><li>another bullet</li></ul>
</div>
`)

htmlToMarkdownTest( `<a href="https://mylink.com/thing?param=*&param2=*" title="*" alt="*">*</a>`,
  `[&ast;](https://mylink.com/thing?param=%2A&param2=%2A)`)

htmlToMarkdownTest( `<meta charset='utf-8'><meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-53028a7e-7fff-b49d-b75a-b28cb5b9afa5"><p dir="ltr" style="line-height:1.38;margin-top:12pt;margin-bottom:12pt;"><a href="https://www.perseus.tufts.edu/hopper/morph?l=*%29elwi%2F&amp;la=greek&amp;can=*%29elwi%2F0&amp;prior=le/gwn" style="text-decoration:none;"><span style="font-size:17pt;font-family:Arial,sans-serif;color:#ffffff;background-color:transparent;font-weight:400;font-style:italic;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Ἐλωί</span></a></p>`,
`
[*Ἐλωί*](https://www.perseus.tufts.edu/hopper/morph?l=%2A%29elwi%2F&la=greek&can=%2A%29elwi%2F0&prior=le/gwn)
` )

htmlToMarkdownTest( `<a href="www.website.com">*hello* **bold** __underscore__ * _ ** random *thing * is **things ** yeah</a>`,
`[*hello* **bold** __underscore__ &ast; &#95; &ast;&ast; random &ast;thing &ast; is &ast;&ast;things &ast;&ast; yeah](www.website.com)` )

htmlToMarkdownTest( `<span style="color:#ffffff">words</span>`,
  `words`
)
htmlToMarkdownTest( `<span style="color:#000000">words</span>`,
  `words`
)
htmlToMarkdownTest( `<span style="color:#555555">words</span>`,
  `words`
)

function testSplitTopicQueryHash( url, expected ) {
  const VERBOSE = false
  let result = splitTopicQueryHash( url );
  if (result[0] == expected[0] && result[1] == expected[1] && result[2] == expected[2]) {
    VERBOSE && console.log( "[testSplitTopicAndHash]", url, "is good" )
  } else {
    console.log( "[testSplitTopicAndHash] FAIL:", url );
    console.log( "Expected" )
    console.log( " - Topic:", expected[0] )
    console.log( " - Query: ", expected[1] )
    console.log( " - Hash: ", expected[2] )
    console.log( "Result" )
    console.log( " - Topic:", result[0] )
    console.log( " - Query: ", result[1] )
    console.log( " - Hash: ", result[2] )
  }
}

testSplitTopicQueryHash( "Topic#Hash", ["Topic", "", "Hash"] )
testSplitTopicQueryHash( "Topic", ["Topic", "", ""] )
testSplitTopicQueryHash( "#Hash", ["", "", "Hash"] )

testSplitTopicQueryHash( "Topic?searchterm=bok#Hash", ["Topic", "searchterm=bok", "Hash"] )
testSplitTopicQueryHash( "Topic?searchterm=bok", ["Topic", "searchterm=bok", ""] )
testSplitTopicQueryHash( "?searchterm=bok#Hash", ["", "searchterm=bok", "Hash"] )


} // if (isBrowser())

module.exports.init = () => {};
