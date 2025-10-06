function youtubeTranscriptCleanup( text ) {
  // Remove lines with timestamps (like 0:01 or 12:34:56)
  text = text.replace(/^[0-9]+:[0-9]+:?([0-9]+)?[^\n]*$/gm, '');

  // Replace newlines with spaces
  text = text.replace(/\n+/g, ' ');

  // Replace [ __ ] with *expletive*
  text = text.replace(/\[\s*__\s*\]/g, '*expletive*');

  // Remove filler words “uh” and “um” surrounded by spaces
  text = text.replace(/\suh\s/g, ' ');
  text = text.replace(/\sum\s/g, ' ');

  // Convert [something] → linebreaks around the content inside brackets
  text = text.replace(/\s*\[([^\]]+)\]\s*/g, '\n$1\n');

  return text
}

// Example usage:
// youtubeTranscriptRemoveTimestamps('./example.txt');
