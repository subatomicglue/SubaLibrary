#!/usr/bin/env node

/**
 * A simple Markdown parser that builds an AST based on a defined grammar.
 * This is a basic implementation and can be extended with more rules as needed.
 */

// ---------- Example grammar (you can replace/extend this) ----------
const grammar = {
  Document: {
    type: "block",
    children: ["CustomBlock_InvisibleBox", "CustomBlock_CodeFence", "List", "Heading", "BlankLine", "Paragraph"]
  },

  BlankLine: {
    type: "block",
    regex: /(?<=(^|\n))(\s*?\n+)/,
    children: []
  },

  // --- Block types ---
  CustomBlock_InvisibleBox: {
    type: "block",
    regex: /(?<=(^|\n))(?:===)(?:[a-zA-Z]*)\n([\s\S]*?)\n(?:===)\n/,
    children: ["Heading", "List", "CustomBlock_CodeFence", "BlankLine", "Paragraph"]
  },

  CustomBlock_CodeFence: {
    type: "block",
    // a fenced code block (multiline)
    regex: /^```\n([\s\S]*?)\n```(?:\n|$)/m,
    children: ["RawText"]
  },

  Heading: {
    type: "block",
    // match whole heading line (capture group content not required by parse engine)
    regex: /^#{1,6}\s([^\n]*)(?:\n|$)/m,
    children: []
  },

  // List: {
  //   type: "block",
  //   // consecutive list items (simple detection)
  //   regex: /^(?:(?:\*|\-|\d+\.)\s.*(?:\n|$))+/m,
  //   children: []
  // },

  List: {
    type: "block",
    // allow bullets *, -, + or numbered 1., 2., and capture consecutive items
    regex: /^(?:[*+\-]|\d+\.)[ \t]+[^\n]*(?:\n(?:(?: {2,}|\t)[^\n]+|\s*(?:[*+\-]|\d+\.)[ \t]+[^\n]*)?)*\n?/m,
    children: ["ListItem"]
  },


  ListItem: {
    type: "block",
    regex: /^(?:[*+\-]|\d+\.)[ \t]+([^\n]*)(?:\n(?!\s*(?:[*+\-]|\d+\.|\n))[^].*)*/m,
    children: []
  },


  Paragraph: {
    type: "block",
    regex: /^(?:[^\n].*(?:\n(?!\s*\n)|$))+/m,
    children: ["Bold", "Italic", "InlineText"]
  },

  RawText: {
    type: "block",
    regex: /^(?:[^\n].*(?:\n(?!\s*\n)|$))+/m,
    children: []
  },


  // // --- Inline rules (small example set) ---
  // Inline: { type: "inline", children: ["Bold", "Italic", "CodeSpan", "Text"] },

  Bold: {
    type: "inline",
    regex: /\*\*([^*\n\s](?:[^*\n]*?[^*\n\s])?)\*\*/gm,
    children: [ "InlineText"]
  },

  Italic: {
    type: "inline",
    regex: /\*([^*\n\s](?:[^*\n]*?[^*\n\s])?)\*/gm,
    children: ["InlineText"]
  },

  // CodeSpan: { type: "inline", regex: /`([^`]*)`/s, children: [] },
  InlineText: { type: "inline", regex: /[\s\S]+/s, children: [] },


  // Freetext rule (used when text doesn't match any child rule)
  // Freetext: { type: "leaf", regex: /[\s\S]+/, children: [] }
};


function mergeFlags(flags, add) {
  const set = new Set((flags + add).split(""));
  return Array.from(set).join("");
}


/**
 * Partition the markdown text into non-overlapping regions according to rule order.
 */

function parse(markdown, ruleName = "Document") {
  const rule = grammar[ruleName];
  if (!rule || !rule.children) {
    return [{ type: ruleName, raw: markdown, children: [] }];
  }

  let segments = [{ type: "Unidentified", raw: markdown }];

  for (const childName of rule.children) {
    const childRule = grammar[childName];
    if (!childRule || !childRule.regex) continue;

    const nextSegments = [];

    for (const seg of segments) {
      if (seg.type !== "Unidentified") {
        nextSegments.push(seg);
        continue;
      }

      const text = seg.raw;
      const re = new RegExp(childRule.regex.source, mergeFlags(childRule.regex.flags, "g"));

      let lastIndex = 0;
      let m;

      while ((m = re.exec(text)) !== null) {
        if (m[0].length === 0) {
          re.lastIndex++;
          continue;
        }
        const start = m.index;
        const end = start + m[0].length;
        if (end === lastIndex) break; // prevent infinite loop

        // leading unidentified
        if (start > lastIndex) {
          const lead = text.slice(lastIndex, start);
          //if (lead.trim() !== "")
            nextSegments.push({ type: "Unidentified", raw: lead });
        }

        // matched block
        nextSegments.push({
          type: childName,
          original: m[0],
          raw: m[1] ? m[1] : m[0],
          children: []
        });

        lastIndex = end;
      }

      // trailing unidentified
      if (lastIndex < text.length) {
        const tail = text.slice(lastIndex);
        if (tail.trim() !== "")
          nextSegments.push({ type: "Unidentified", raw: tail });
      }
    }

    segments = nextSegments;
  }

  // Recursively parse children for any segment that has child rules
  const result = segments
    .filter(s => !(s.type === "Unidentified"))
    .map(s => {
      const rule = grammar[s.type];
      if (rule && rule.children && rule.children.length > 0) {
        s.children = parse(s.raw, s.type);
      }
      return s;
    });

  return result;
}



// ---------- Example usage ----------
const example = `# Title

Paragraph with **bold** *italic* inside.

* First list item
* Second list item

\`\`\`
some code()
\`\`\`

===invisiblebox
# text in a box
paragraph inside box
\`\`\`
code block inside box
\`\`\`
===
`;

const ast = parse(example, "Document");
console.log(JSON.stringify(ast, null, 2));
