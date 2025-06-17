#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const {
  WIKI_DIR,
  WIKI_CHANGELOG_TOPICNAME,
} = require('./settings');


// Function to compact subsequent "Edited" lines...  we'll keep the endTime in the merged result.
function mergeLines(logLines) {
  const mergedLines = [];
  let currentMerge = null;

  function formatMergedLine(mergeInfo) {
    return `[${mergeInfo.endTime}] ${mergeInfo.userLink} : Edited '${mergeInfo.pageName}' to ${mergeInfo.versions.join(' ')}`;
  }

  logLines.forEach(line => {
    const editedFormatMatch = line.match(/^\[([0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9])\] \[([^\]]+?)\]\(([^)]+?)\) : Edited '([^']+?)' to (.+)$/);

    let startTime, endTime, userLink, pageName, versionInfo;

    if (editedFormatMatch) {
      startTime = editedFormatMatch[1];
      endTime = editedFormatMatch[1];
      userLink = `[${editedFormatMatch[2]}](${editedFormatMatch[3]})`;
      pageName = editedFormatMatch[4];
      versionInfo = editedFormatMatch[5];
    }
    else {
      mergedLines.push( line )
      return; // Skip merging lines that don't match either format
    }

    if (currentMerge && currentMerge.pageName === pageName) {
      currentMerge.versions.push(versionInfo);
      currentMerge.endTime = currentMerge.endTime > endTime ? currentMerge.endTime : endTime; // Update the earliest time
      currentMerge.startTime = currentMerge.startTime < startTime ? currentMerge.startTime : startTime; // Update the latest time
    } else {
      if (currentMerge) {
        mergedLines.push(formatMergedLine(currentMerge));
      }
      // start a new merge
      currentMerge = {
        startTime: startTime,
        endTime: endTime,
        userLink: userLink,
        pageName: pageName,
        versions: [versionInfo]
      };
    }
  });

  if (currentMerge) {
    mergedLines.push(formatMergedLine(currentMerge));
  }

  return mergedLines;
}

function writeToChangeLog( req, line_without_newline ) {
  const filepath = path.resolve( path.join( WIKI_DIR, WIKI_CHANGELOG_TOPICNAME + ".md" ) )
  const utcTimestamp = new Date();
  const utcYear = utcTimestamp.getFullYear();
  const utcMonth = String(utcTimestamp.getMonth() + 1).padStart(2, '0');
  const utcDay = String(utcTimestamp.getDate()).padStart(2, '0');
  const utcHours = String(utcTimestamp.getHours()).padStart(2, '0');
  const utcMinutes = String(utcTimestamp.getMinutes()).padStart(2, '0');
  const utcSeconds = String(utcTimestamp.getSeconds()).padStart(2, '0');
  const formattedLocalDate = `${utcYear}-${utcMonth}-${utcDay} ${utcHours}:${utcMinutes}:${utcSeconds}`;
  let contents = fs.existsSync( filepath ) ? fs.readFileSync( filepath, 'utf8' ).split('\n').filter(line => line.trim() !== '') : [];
  contents = [ `[${formattedLocalDate}] [${req.user}](WikiUser-${req.user}) : ${line_without_newline}`, ...contents ];
  contents = mergeLines(contents); // do some compaction.
  fs.writeFileSync( filepath, contents.join("\n"), 'utf8' );
}
module.exports.writeToChangeLog = writeToChangeLog;
