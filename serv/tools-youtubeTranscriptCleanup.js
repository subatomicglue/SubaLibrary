function youtubeTranscriptCleanup(text) {
  if (!text) return '';

  // Remove newline directly after timestamps so sentences remain on one line
  text = text.replace(/([0-9]+:[0-9]+(?::[0-9]+)?)[^\S\r\n]*\n+/g, '$1 ');

  const timestampRegex = /^([0-9]+:[0-9]+(?::[0-9]+)?)/;
  const lines = text.split(/\r?\n/);
  const segments = [];
  let paragraphParts = [];

  const flushParagraph = () => {
    if (!paragraphParts.length) return;
    const combined = paragraphParts.join(' ').replace(/\s+/g, ' ').trim();
    if (combined) segments.push(combined);
    paragraphParts = [];
  };

  for (const rawLine of lines) {
    let line = rawLine.trim();
    if (!line) continue;

    const timestampMatch = line.match(timestampRegex);
    if (timestampMatch) {
      const content = line.slice(timestampMatch[0].length).trim();
      if (content) paragraphParts.push(content);
      continue;
    }

    flushParagraph();
    segments.push(line);
  }

  flushParagraph();

  let textOut = segments.map(segment => `${segment}\n\n`).join('');

  // Replace [ __ ] with *expletive*
  textOut = textOut.replace(/\[\s*__\s*\]/g, '*expletive*');

  // Remove filler words “uh” and “um” surrounded by spaces
  textOut = textOut.replace(/\suh\s/g, ' ');
  textOut = textOut.replace(/\sum\s/g, ' ');

  // Convert [something] → linebreaks around the content inside brackets
  textOut = textOut.replace(/\s*\[([^\]]+)\]\s*/g, '\n$1\n');

  return textOut.trimEnd();
}

// Example usage:
// youtubeTranscriptRemoveTimestamps('./example.txt');
