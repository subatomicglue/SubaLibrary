
//////////////////////////////////////////////////////////////////////////////////////
// markdownToHtml
//////////////////////////////////////////////////////////////////////////////////////

// Basic Markdown to HTML conversion using regex, no dependencies,
// Why not use "marked"? Some nice markup here that "marked" wasn't giving me, easy to customize... 
// (happy to switch in the future, if someone can reach parity using marked...
function markdownToHtml(markdown, baseUrl, options = {} ) {
  const options_defaults = {
    link_relative_callback: (baseUrl, url) => `${baseUrl}/${url}`,
    link_absolute_callback: (baseUrl, url) => url,
  }
  options = { ...options_defaults, ...options };

  function isYouTubeURL(url) {
    const youtubeRegex = /^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:&.*)?$/;
    const match = url.match(youtubeRegex);
    return match != undefined
  }
  function convertToYouTubeEmbed(url) {
    const youtubeRegex = /^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})(?:&.*)?$/;
    const match = url.match(youtubeRegex);
    if (match) {
      const videoId = match[1];
      console.log( "videoID", videoId)
      return `<iframe width="100%" height="315" src="https://www.youtube.com/embed/${videoId}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
    }
    return url;
  }
  

  markdown = markdown
    .replace(/^# ([^\n]*)$/gm, "<h1>$1</h1><intentional newline>") // # Header
    .replace(/^## ([^\n]*)$/gm, "<h2>$1</h2><intentional newline>") // ## Sub-header
    .replace(/^### ([^\n]*)$/gm, "<h3>$1</h3><intentional newline>") // ## Sub-header
    .replace(/^#### ([^\n]*)$/gm, "<h4>$1</h4><intentional newline>") // ## Sub-header
    .replace(/^##### ([^\n]*)$/gm, "<h5>$1</h5><intentional newline>") // ## Sub-header
    .replace(/\*\*([^*\n]+)\*\*/gm, "<b>$1</b>") // **bold**
    .replace(/\*([^*\n]+)\*/gm, "<i>$1</i>") // *italic*
    .replace(/^```\s*[\n]?(.*?)[\n]?```/gms, "<code>$1</code>") // ```code```
    .replace(/`([^`\n]*)`/gm, (match, codecontents) => { // `code`
      return codecontents == "" ? "" : `<tt>${codecontents}</tt>`
    })
    // Convert images
    .replace(/\!\[([^\]]+)\]\(([^\)\n]+)\)/g, (match, title, url) => { // ![image title](image url)
      const VERBOSE=false
      VERBOSE && console.log( "[markdown] img", url.match( /^\// ) ? url : `${baseUrl}/${url}` )
      return `<img src="${url.match( /^(\/|http)/ ) ? url : `${baseUrl}/${url}`}" alt="${title}" title="${title}"/>`
    })
    .replace(/\[([^\]\n]+)\]\(([^\)\n]+)\)/g, (match, title, url) => { // [title text](url)
      const VERBOSE=false
      const THEURL = url.match( /^https?/ ) ? url : url.match( /^\// ) ? options.link_absolute_callback( baseUrl, url ) : options.link_relative_callback( baseUrl, url );
      VERBOSE && console.log( "[markdown] link", THEURL )
      if (isYouTubeURL(url))
        return convertToYouTubeEmbed(url)
      else
        return `<a href="${THEURL}">${title}</a>`
    })
    // Convert naked URLs
    .replace(/(?<=^|\s)https?:\/\/[^\s<]+[^\s<\.,;](?=\s|\n|$)/g, (url) => { 
      const VERBOSE = false;
      VERBOSE && console.log("[markdown] naked URL", url);
      if (isYouTubeURL(url))
        return convertToYouTubeEmbed(url)
      else
        return `<a href="${url}">${url}</a>`;
    })

  // tables:
  // | Header 1 | Header 2 | Header 3 |
  // |:---------|:--------:|---------:|                    <-- optional, creates heading columns if present
  // | Row 1, Col 1 | Row 1, Col 2 | Row 1, Col 3 |
  // | Row 2, Col 1 | Row 2, Col 2 | Row 2, Col 3 |
  markdown = markdown.replace( /^(\|.+\|\n)((\|:?-+:?)+\|\n)?((\|.+\|\n)*)/gm, (match, firstline, nextline, nextline_col, lastlines, lastline ) => {
    const VERBOSE=false
    firstline = firstline.replace(/\n$/, '');
    lastlines = lastlines ? lastlines.replace(/\n$/,'').split( "\n" ) : []
    let justification = "left";
    if (nextline) {
      nextline =  nextline.replace(/\n$/, '');
      justification = nextline ? nextline.replace( /(:?)([-_=]+)(:?)/g, (m, left, dashes, right) => left && right ? "center" : right ? "right" : "left").replace(/(^\||\|$)/g,'').split('|') : undefined
    }
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
  for (let depth = 6; depth >= 1; --depth) { // Depth levels
    let indent = " ".repeat(depth * 2) + "?"; // Match increasing indentation levels

    // unordered lists (-, +, *)
    markdown = markdown.replace( new RegExp( `(?:^|\\n)((${indent})([-+*]) .*(?:\\n\\2\\3 .*)*)`, "gim" ), (match, match2, indents, bullet) => {
      return `<ul>` + match.replace( /^\s*[-+*]\s+(.*?)$/gim, `<li>$1</li>` ).replace(/\n/g,"") + `</ul>` // * bullet
    })
    // numbered lists (1., 2., 3., etc.)
    markdown = markdown.replace( new RegExp( `(?:^|\\n)((${indent})([0-9]{1,2}|[a-z]{1,2}|[A-Z]{1,2}|[IVXLCDM]+|[ivxlcdm]+)\\. .*(?:\\n\\2([0-9]{1,2}|[a-z]{1,2}|[A-Z]{1,2}|[IVXLCDM]+|[ivxlcdm]+)\\. .*)*)`, "gim" ), (match, match2, indents, bullet) => {
      // type="1"	The list items will be numbered with numbers (default)
      // type="A"	The list items will be numbered with uppercase letters
      // type="a"	The list items will be numbered with lowercase letters
      // type="I"	The list items will be numbered with uppercase roman numbers
      // type="i"	The list items will be numbered with lowercase roman numbers
      let type = bullet.match(/^[0-9]{1,2}$/) ? "1" :
                 bullet.match(/^i$/) ? "i" : // roman numeral. detect the start of an <ol>, look for the first, just i, since it overlaps with a-z. we're limited to start with i. Also, HTML can't start with anything but i.
                 bullet.match(/^I$/) ? "I" : // roman numeral. detect the start of an <ol>, look for the first, just I, since it overlaps with a-z, we're limited to start with I. Also, HTML can't start with anything but I.
                 bullet.match(/^[a-z]{1,2}$/) ? "a" :
                 bullet.match(/^[A-Z]{1,2}$/) ? "A" :
                 "1"
      return `<ol type="${type}" start="${bullet}">` + match.replace( /^\s*([0-9]{1,2}|[a-z]{1,2}|[A-Z]{1,2}|[IVXLCDM]+|[ivxlcdm]+)\.\s+(.*?)$/gim, `<li>$2</li>` ).replace(/\n/g,"") + `</ol>` // * bullet
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

  // Convert line breaks (two spaces at the end of a line)
  //markdown = markdown.replace(/\n\s*\n/g, '<br>');

  return markdown
  .replace(/^\s*\n(?:\s*\n)*/gm, "<p>") // New lines to <p>
  .replace(/<intentional newline>\n/gm, "<intentional newline>") // remove newlines where intentional, to avoid <BR>
  .replace(/\n/gm, "<br>\n") // New lines to <br>
  .replace(/<intentional newline>/gm, "\n") // add back in intentional newlines
}


//////////////////////////////////////////////////////////////////////////////////////
// htmlToMarkdown
//////////////////////////////////////////////////////////////////////////////////////

// scoop up entire HTML DOM into a structured object tree
// (one node per HTML element, with attributes and child nodes).
function _parseHTMLToTree(htmlString) {
  let document;

  // Detect environment and parse HTML
  if (typeof window !== 'undefined' && typeof DOMParser !== 'undefined') {
    // Browser environment: Use DOMParser
    const parser = new DOMParser();
    document = parser.parseFromString(htmlString, 'text/html');
    Node = window.Node; // Use the browser's Node API
  } else {
    // Node.js environment: Use jsdom
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM(htmlString);
    document = dom.window.document;
    Node = dom.window.Node; // Use Node API from jsdom
  }

  // Function to recursively convert DOM elements into a hierarchical object tree
  function elementToObject(element) {
    const obj = {
      tagName: element.tagName ? element.tagName.toLowerCase() : null,
      attributes: {},
      children: [],
    };

    // Collect attributes
    if (element.attributes) {
      for (const attr of element.attributes) {
        obj.attributes[attr.name] = attr.value;
      }
    }

    // Process child nodes
    for (const child of element.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        obj.children.push(elementToObject(child)); // Recursive for elements
      } else if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent;//.trim();
        if (text) {
          obj.children.push({ type: 'text', content: text }); // Text node
        }
      }
    }

    return obj;
  }

  // Parse the document body into a tree structure
  const tree = [];
  for (const child of document.body.childNodes) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      tree.push(elementToObject(child));
    }
  }

  return tree;
}

function _htmlTreeToMarkdown(tree) {
  const indentLevelStart = 0;
  let indentLevel = indentLevelStart;
  let list_stats = []

  // Helper function to check for `font-weight > 400` in the `style` attribute
  function isBold(node) {
    if (node.attributes && node.attributes.style) {
      const fontWeightMatch = node.attributes.style.match(/font-weight:\s*(\d+)/);
      if (fontWeightMatch) {
        const fontWeight = parseInt(fontWeightMatch[1], 10);
        return fontWeight > 400; // Return true if font-weight > 400
      }
    }
    return false; // Default to false
  }

  function isColor(node) {
    if (node.attributes && node.attributes.style) {
      const colorMatch = node.attributes.style.match(/color:\s*(#[0-9a-fA-F]+)/);
      if (colorMatch && colorMatch[1] && colorMatch[1] != "#000000") {
        return colorMatch[1];
      }
    }
    return false;
  }

  function isMonospace(node) {
    if (node.attributes && node.attributes.style) {
      return /font-family:[^:;]*monospace/.test(node.attributes.style) || /font-family:[^:;]*Courier/.test(node.attributes.style);
    }
    return false; // Default to false
  }

  function isBulletlessList(node) {
    if (node.attributes && node.attributes.style) {
      return /list-style:\s*none/.test(node.attributes.style) // Detect "list-style: none"
    }
    return false;
  }
  function getIndents(node) {
    if (node.attributes && node.attributes.style) {
      let m = node.attributes.style.match( /margin-left:\s*([\d.]+)pt/ );
      let indentLevel = m ? m[1] : `${indentLevelStart+1}`;
      const indent = parseFloat(indentLevel); // Get the numeric value in points
      return Math.floor(indent / 36); // starts at 72, then increments by 36pt corresponds to each level
    }
    return 0; // zero indent
  }

  function convertListIndexToMarkdown(node, index) {
    function toRoman(num) {
      const romanNumerals = [
        ["M", 1000],["CM", 900],["D", 500],["CD", 400],
        ["C", 100],["XC", 90],["L", 50],["XL", 40],
        ["X", 10],["IX", 9],["V", 5],["IV", 4], ["I", 1],
      ];
      let result = "";
      for (const [roman, value] of romanNumerals) {
        while (num >= value) {
          result += roman;
          num -= value;
        }
      }
      return result;
    }

    if (node.attributes && node.attributes.style) {
      if (/list-style-type:\s*decimal/.test(node.attributes.style))
        return index + 1 + "."; // Return index + 1 for decimal lists
      else if (/list-style-type:\s*lower-alpha/.test(node.attributes.style))
        return String.fromCharCode(97 + (index % 26)) + "."; // 97 is ASCII for 'a'
      else if (/list-style-type:\s*upper-alpha/.test(node.attributes.style))
        return String.fromCharCode(65 + (index % 26)) + "."; // 65 is ASCII for 'A'
      else if (/list-style-type:\s*lower-roman/.test(node.attributes.style))
        return toRoman(index + 1).toLowerCase() + "."; // Convert to lowercase Roman numeral
      else if (/list-style-type:\s*upper-roman/.test(node.attributes.style))
        return toRoman(index + 1) + "."; // Convert to uppercase Roman numeral
    }
    return "-";
  }

  function convertNodeToMarkdown(node) {
    if (node.type === 'text') {
      //console.log( `TEXT:  "${node.content}"`)
      return node.content;//.trim(); // Handle plain text nodes
    }

    // Check whether the node has `font-weight > 400` and wrap its content in `**`
    const isNodeBold = isBold(node);
    const isNodeMonospace = isMonospace(node);
    const isNodeColored = isColor(node)

    // Handle specific HTML tags
    switch (node.tagName) {
      case 'h1':
        return `# ${node.children.map(convertNodeToMarkdown).join('')}\n\n`;
      case 'h2':
        return `## ${node.children.map(convertNodeToMarkdown).join('')}\n\n`;
      case 'h3':
        return `### ${node.children.map(convertNodeToMarkdown).join('')}\n\n`;
      case 'h4':
        return `#### ${node.children.map(convertNodeToMarkdown).join('')}\n\n`;
      case 'h5':
        return `##### ${node.children.map(convertNodeToMarkdown).join('')}\n\n`;
      case 'h6':
        return `###### ${node.children.map(convertNodeToMarkdown).join('')}\n\n`;
      case 'p': {
        const content = node.children.map(convertNodeToMarkdown).join('');
        if (isNodeMonospace) {
          return `\`\`\`\n${content}\n\`\`\`\n\n`;
        }
        let levels = getIndents(node)
        return `${'>'.repeat(levels)}${isNodeBold ? `**${content}**` : content}\n\n`;
      }
      case 'strong':
        return `**${node.children.map(convertNodeToMarkdown).join('')}**`;
      case 'em':
        return `*${node.children.map(convertNodeToMarkdown).join('')}*`;
      case 'blockquote': {
        indentLevel++; // Increase indentation level for nested blockquotes
        list_stats.push( {items:-1} )
        const content = node.children.map(convertNodeToMarkdown).join('').trim();
        const blockquotePrefix = `${'>'.repeat(indentLevel)} `;
        list_stats.pop();
        indentLevel--; // Decrease indentation level after processing the blockquote
        return `${blockquotePrefix}${content}\n`;
      }
      case 'ul': {
        indentLevel++; // Increase indentation level for nested lists
        list_stats.push( {items:-1} )
        const content = node.children.map(convertNodeToMarkdown).join('') + (indentLevel == (indentLevelStart+1)?'\n':'');
        list_stats.pop();
        indentLevel--; // Decrease indentation level after processing the list
        if (isBulletlessList(node)) {
          return `${'>'.repeat(indentLevel)}${content}\n`;
        } else {
          return content;
        }
      }
      case 'ol': {
        indentLevel++; // Increase indentation level for nested lists
        list_stats.push( {items:-1} )
        const content = node.children.map(convertNodeToMarkdown).join('') + (indentLevel == (indentLevelStart+1)?'\n':'');
        list_stats.pop();
        indentLevel--; // Decrease indentation level after processing the list
        return content;
      }
      case 'li':
        let content = node.children.map(convertNodeToMarkdown).join('')
        let bullet = convertListIndexToMarkdown(node, ++list_stats[list_stats.length-1].items )
        return `${' '.repeat(1 + (indentLevel-1)*2)}${bullet} ${content.replace(/\n+$/g, '').replace(/\n/g, '<br>')}\n`;
      case 'a':
        const href = node.attributes.href || '';
        return `[${node.children.map(convertNodeToMarkdown).join('')}](${href})`;
      case 'img':
        const src = node.attributes.src || '';
        const alt = node.attributes.alt || '';
        return `![${alt}](${src})`;
      case 'code':
        return `\`${node.children.map(convertNodeToMarkdown).join('')}\``;
      case 'pre':
        return `\`\`\`\n${node.children.map(convertNodeToMarkdown).join('')}\n\`\`\`\n\n`;
      case 'br':
        return `\n`;
      case 'table': {
        const rows = node.children.map(convertNodeToMarkdown).join('\n');
        return `${rows}\n\n`;
      }
      case 'thead': {
        const cells = node.children.map(convertNodeToMarkdown).join(' | ');
        return `${cells}\n|${'|---'.repeat(cells.split('|').length-1)+'|'}`;
      }
      case 'tr': {
        const cells = node.children.map(convertNodeToMarkdown).join(' | ');
        return `| ${cells} |\n`;
      }
      case 'td': {
        const content = node.children.map(convertNodeToMarkdown).join('').trim();
        return isNodeBold ? `**${content}**` : content; // Bold text if applicable
      }
      case 'th': {
        const content = node.children.map(convertNodeToMarkdown).join('').trim();
        return isNodeBold ? `**${content}**` : content; // Bold text if applicable
      }
      case 'span': {
        let content = node.children.map(convertNodeToMarkdown).join('');
        content = isNodeColored ? `<span style="color:${isNodeColored}">` + content + `</span>` : content
        if (isNodeMonospace) {
          // Convert to inline code
          // console.log( `before [${content.replace(/\n/g,"\\n")}]` );
          content = content.replace( /\n/g, '\n' ).replace(/^(.*)$/, '`$1`')
          // console.log( `after [${content.replace(/\n/g, "\\n")}]` );
          return content;
        }
        let levels = getIndents(node)
        return `${'>'.repeat(levels)}${isNodeBold ? `**${content}**` : content}`;
      }
      default: {
        // Default fallback: Render children only
        let levels = getIndents(node)
        const content = node.children.map(convertNodeToMarkdown).join('');
        return `${'>'.repeat(levels)}${isNodeBold ? `**${content}**` : content}`;
      }
    }
  }

  // Iterate through the tree and convert each node to Markdown
  return tree.map(convertNodeToMarkdown).join('');
}

function htmlToMarkdown( str ) {
  const htmlTree = _parseHTMLToTree(str);
  let markdown_str = _htmlTreeToMarkdown( htmlTree );
  return markdown_str;
}

// HTML testing
// let txt = `<p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">Believed. &nbsp; Proposed.&nbsp; Lazy language scholars.</span></p><br /><p dir="ltr" style="line-height:1.38;margin-top:0pt;margin-bottom:0pt;"><span style="font-size:11pt;font-family:Arial,sans-serif;color:#000000;background-color:transparent;font-weight:400;font-style:normal;font-variant:normal;text-decoration:none;vertical-align:baseline;white-space:pre;white-space:pre-wrap;">&ldquo;Israelian Hebrew (or IH) is a northern dialect of biblical Hebrew (BH) proposed as an explanation for various irregular linguistic features of the Masoretic Text (MT) of the Hebrew Bible. It competes with the alternative explanation that such features are Aramaisms, indicative either of late dates of composition or of editorial emendations. Although IH is not a new proposal, it only started gaining ground as a&rdquo;</span></p>`
// console.log( "htmlToMarkdown ===============" )
// console.log( htmlToMarkdown( txt ) );
// console.log( "htmlToMarkdown done===========" )
// console.log( "htmlToMarkdown ===============" )
// console.log( markdownToHtml(htmlToMarkdown( txt ), "/wiki") );
// console.log( "htmlToMarkdown done===========" )

// markdown testing
// let txt = `# heading1
// ## heading 2
// body text
// `
// console.log( txt )
// console.log( "htmlToMarkdown ===============" )
// console.log( markdownToHtml(txt, "/wiki") );
// console.log( "htmlToMarkdown done===========" )


module.exports.markdownToHtml = markdownToHtml;
module.exports.htmlToMarkdown = htmlToMarkdown;
