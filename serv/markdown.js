
// Basic Markdown to HTML conversion using regex, no dependencies,
// Why not use "marked"? Some nice markup here that "marked" wasn't giving me, easy to customize... 
// (happy to switch in the future, if someone can reach parity using marked...
function markdownToHtml(markdown, baseUrl) {
  //return marked.parse( markdown );

  markdown = markdown
    .replace(/^# ([^\n]*)$/gm, "<h1>$1</h1>") // # Header
    .replace(/^## ([^\n]*)$/gm, "<h2>$1</h2>") // ## Sub-header
    .replace(/^### ([^\n]*)$/gm, "<h3>$1</h3>") // ## Sub-header
    .replace(/^#### ([^\n]*)$/gm, "<h4>$1</h4>") // ## Sub-header
    .replace(/^##### ([^\n]*)$/gm, "<h5>$1</h5>") // ## Sub-header
    .replace(/\*\*([^*\n]+)\*\*/gm, "<b>$1</b>") // **bold**
    .replace(/\*([^*\n]+)\*/gm, "<i>$1</i>") // *italic*
    .replace(/^```\s*[\n]?(.*?)[\n]?```/gms, "<code>$1</code>") // ```code```
    .replace(/`([^`\n]+)`/gm, "<tt>$1</tt>") // `code`
    .replace(/\[([^\]\n]+)\]\(([^\)\n]+)\)/g, (match, title, url) => {
      const VERBOSE=false
      VERBOSE && console.log( "[markdown] link", url.match( /^\// ) ? url : `${baseUrl}/${url}` )
      return `<a href="${url.match( /^(\/|http)/ ) ? url : `${baseUrl}/${url}`}">${title}</a>` // [link](to url)
    })

  // tables:
  // | Header 1 | Header 2 | Header 3 |
  // |:---------|:--------:|---------:|                    <-- optional, creates heading columns if present
  // | Row 1, Col 1 | Row 1, Col 2 | Row 1, Col 3 |
  // | Row 2, Col 1 | Row 2, Col 2 | Row 2, Col 3 |
  markdown = markdown.replace( /^(\|.+\|\n)((\|:?-+:?)+\|\n)?((\|.+\|\n)*)/gm, (match, firstline, nextline, nextline_col, lastlines, lastline ) => {
    const VERBOSE=false
    firstline = firstline.replace(/\n$/, '');
    nextline = nextline.replace(/\n$/, '');
    lastlines = lastlines ? lastlines.replace(/\n$/,'').split( "\n" ) : []
    justification = nextline ? nextline.replace( /(:?)([-_=]+)(:?)/g, (m, left, dashes, right) => left && right ? "center" : right ? "right" : "left").replace(/(^\||\|$)/g,'').split('|') : undefined
    let lines = [ firstline, ...lastlines ]

    VERBOSE && console.log( "[markdown] table: firstline: ", firstline )
    VERBOSE && console.log( "[markdown] table: nextline:  ", nextline )
    VERBOSE && lastlines.forEach( r => console.log( "[markdown] table: lastlines: ", r ) )
    VERBOSE && nextline && console.log( "[markdown] table: justify:   ", justification )
    VERBOSE && console.log( "[markdown] table: lines", lines )

    let result = "<table class='markdown-table'>"
    let whichline = 0
    lines.forEach( line => {
      let is_heading = nextline && whichline == 0
      VERBOSE && console.log( `[markdown] table:  o line[${whichline.toString().padStart(lines.length.toString().length, "0")}]:'${line}'${is_heading ? " <-- heading" : ""}` )
      result += `<${is_heading ? "thead" : "tbody"}><tr>`
      let whichcol = -1
      result += line.replace( /\|\s*([^\|\n]+?)\s*(?=\||\|$)/g, (match, content) => {
        ++whichcol
        let just = justification[Math.min( justification.length, whichcol )];
        VERBOSE && console.log( `[markdown] table:    - ${is_heading ? "heading" : "content"}:'${content}' col:'${whichcol}' just:'${just}'` )
        return `<${is_heading?'th':'td'} style='text-align:${just};'>${content}</${is_heading?'th':'td'}>`
      }).replace( /\s*\|$/, '' ) // eat the last trailing |
      result += `</tr></${is_heading ? "thead" : "tbody"}>`
      ++whichline
    })
    result += "</table>"
    VERBOSE && console.log( `[markdown] table: html:${result}` )
    return result
  })

  // nested lists
  // * my bullet
  //   1. my hindu numbered bullets
  //     i. my roman numbered bullets
  //     ii. my roman numbered bullets
  //     iii. my roman numbered bullets
  //       a. my english alphabet lowercase bullets
  //         A. my english alphabet uppercase bullets
  //           8. can begin at any 'number' in whatever numeric alphabet (except 'i')
  //           3. but, subsequent ones will auto-number (ignores your typed number on the 2-n ones)
  //             i. beginning with 'i' starts a roman numbered list, rather than "starting at 'i'" english alphabet list, sad but nessesary.
  //   2. continuing from 1 above
  for (let depth = 6; depth >= 0; --depth) { // Depth levels
    let indent = " ".repeat(1 + depth * 2) + "?"; // Match increasing indentation levels

    // unordered lists (-, +, *)
    markdown = markdown.replace( new RegExp( `(?:^|\\n)((${indent})([-+*]) .*(?:\\n\\2\\3 .*)*)`, "gim" ), (match, match2, indents, bullet) => {
      return `<ul>` + match.replace( /^\s*[-+*]\s+(.*?)$/gim, `<li>$1</li>` ).replace(/\n/g,"") + `</ul>` // * bullet
    })
    // numbered lists (1., 2., 3., etc.)
    markdown = markdown.replace( new RegExp( `(?:^|\\n)((${indent})([0-9]+|[a-z]+|[A-Z]+|[IVXLCDM]+|[ivxlcdm]+)\\. .*(?:\\n\\2([0-9]+|[a-z]+|[A-Z]+|[IVXLCDM]+|[ivxlcdm]+)\\. .*)*)`, "gim" ), (match, match2, indents, bullet) => {
      // type="1"	The list items will be numbered with numbers (default)
      // type="A"	The list items will be numbered with uppercase letters
      // type="a"	The list items will be numbered with lowercase letters
      // type="I"	The list items will be numbered with uppercase roman numbers
      // type="i"	The list items will be numbered with lowercase roman numbers
      let type = bullet.match(/[0-9]+/) ? "1" :
                 bullet.match(/[i]+/) ? "i" :  // roman numeral.   just i, since it overlaps with a-z
                 bullet.match(/[a-z]+/) ? "a" :
                 bullet.match(/[i]+/) ? "I" : // roman numeral.   just i, since it overlaps with a-z
                 bullet.match(/[A-Z]+/) ? "A" :
                 "1"
      return `<ol type="${type}" start="${bullet}">` + match.replace( /^\s*([0-9]+|[a-z]+|[A-Z]+|[IVXLCDM]+|[ivxlcdm]+)\.\s+(.*?)$/gim, `<li>$2</li>` ).replace(/\n/g,"") + `</ol>` // * bullet
    })
  }

  // blockquote >, >>, >>>
  markdown = markdown.replace(/(^>+[^\S\r\n]?.*?(?:\n>+[^\S\r\n]?.*)*)(?=\n[^>]|$)/gm, (match) => {
    // Map lines to { level, content }
    const lines = match.trim().split('\n').map(line => {
        const level = line.match(/^>+/)[0].length; // Count number of '>'
        const content = line.replace(/^>+\s?/, ''); // Remove '>' and space
        return { level, content };
    });

    // Combine consecutive lines of the same "level"
    const reducedLines = lines.reduce((acc, curr) => {
        const prev = acc[acc.length - 1];
        if (prev && prev.level === curr.level) {
            prev.content += ' ' + curr.content; // Merge lines with same level
        } else {
            acc.push(curr);
        }
        return acc;
    }, []);

    // Convert to nested blockquotes using a stack
    let result = '';
    let stack = [];
    for (const { level, content } of reducedLines) {
        while (stack.length > level) {
            result += '</blockquote>';
            stack.pop();
        }
        while (stack.length < level) {
            result += '<blockquote>';
            stack.push('<blockquote>');
        }
        result += content + '\n';
    }
    while (stack.length) {
        result += '</blockquote>';
        stack.pop();
    }
    return result.trim();
  });

  return markdown
  .replace(/^\s*\n(?:\s*\n)*/gm, "<p>") // New lines to <p>
  .replace(/\n/gm, "<br>") // New lines to <br>
}

module.exports.markdownToHtml = markdownToHtml;
