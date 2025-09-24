#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const express = require("express");
const router = express.Router();
const sanitizer = require('./sanitizer');
const { sanitize, sanitizeFloat, sanitizeInt, sanitizeTopic } = sanitizer;
const template = require('./template');
const { markdownToHtml } = require('./markdown');
const { makeRSS } = require('./router-rss-torrent');

const SETTINGS = require('./settings');

const args = process.argv.slice(2);
const nonDestructive = args.includes('--non-destructive');
const forceRegen = args.includes('--force');
const VERBOSE = args.includes('--verbose');

const inputDir = SETTINGS.WIKI_DIR;
const outputDir = path.join(__dirname, 'build');

class Req {
  constructor( topic, baseUrl = "/wiki", subPath = "/view/" ) {
    this.baseUrl = baseUrl;
    this.originalUrl = `${this.baseUrl}${subPath}`+topic//+".html"
    this.canonicalUrl = `${this.protocol}://${this.get('host')}${this.originalUrl}`;
    this.canonicalUrlRoot = `${this.protocol}://${this.get('host')}`;
    this.canonicalUrlDomain = `${this.get('host')}`;
    this.user = "---"
    this.prodMode = true; // running a production URL.
    this.staticMode = true; // definitely generating static content
  }
  get(str) { return { host: SETTINGS.DOMAINS[1] }[str] } // assume the first DOMAIN[] is the one
  protocol = "https"
  originalUrl = "/"
  baseUrl = "/wiki" // mirrors what we see on live site
}

// generate .html file.
function wrapWithFrame(content, topic, req, t=new Date()) {
  return template.file( "template.page.html", {
    ...SETTINGS, ...{ CANONICAL_URL: req.canonicalUrl, CANONICAL_URL_ROOT: req.canonicalUrlRoot, CANONICAL_URL_DOMAIN: req.canonicalUrlDomain, CURRENT_DATETIME: t.toISOString().replace(/\.\d{3}Z$/, '+0000') },
    SOCIAL_TITLE: `${SETTINGS.TITLE}${(topic != "index") ? ` - ${topic}` : ""}`,
    BACKBUTTON_PATH: `/`,
    ASSETS_MAGIC: "assets",
    BACKBUTTON_VISIBILITY: `visible`,//`hidden`,
    BACKBUTTON_IMAGE: `/assets/home_24dp_E3E3E3_FILL0_wght400_GRAD0_opsz24.svg`,
    PAGE_TITLE: `<a href="/">/</a>${topic}`,
    USER: `${req.user}`,
    SCROLL_CLASS: "scroll-child-wiki",
    WHITESPACE: "normal",
    REQ_BASEURL: req.baseUrl, // view/wiki
    //SEARCH_URL: `https://${SETTINGS.HOSTNAME_FOR_EDITS}.${SETTINGS.DOMAINS[0]}${req.baseUrl}/search`,
    SEARCH_URL: `${req.baseUrl}/search`,
    BODY: `<%include "template.page-search.html"%><div id="the-scroll-page" style="max-width: 60rem; margin-left: auto; margin-right: auto; padding-left: 2em;padding-right: 2em;padding-top: 1em;padding-bottom: 1em;">${content}</div>`,
    USER_LOGOUT: `<a id="signin-link" style="color: grey;" href="https://${SETTINGS.HOSTNAME_FOR_EDITS}.${SETTINGS.DOMAINS[0]}/login">&nbsp;signin</a>`,
    SEARCH: `<span id="search" onclick='search()'><img src="/assets/search_24dp_E3E3E3_FILL0_wght400_GRAD0_opsz24.svg" alt="[search]" title="[search]"></span>`,
  })
}

// sync utility for re-generating a directory, while only minimally changing timestamps
class SyncToFileSystem {
  constructor(destination) {
    this.destination = destination;
    this.inventory = this.scanDirectory(destination);
    VERBOSE && console.log("[SyncToFileSystem] ", this.inventory)
  }

  scanDirectory(dir) {
    let files = {};
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        files = { ...files, ...this.scanDirectory(fullPath) };
      } else {
        files[path.relative(this.destination, fullPath)] = false; // initially mark all files as not written
      }
    }
    return files;
  }

  markWritten(filePath, skipped = false) {
    let relPath = path.relative(this.destination, filePath);

    if (this.inventory == undefined) {
      console.log( "[SyncToFileSystem] inventory undefined" )
      process.exit( -1 )
    }
    if (relPath in this.inventory)
      this.inventory[relPath] = skipped ? 3 : true;
    else {
      VERBOSE && console.log( "[SyncToFileSystem] new file written to:", relPath )
      this.inventory[relPath] = true;
    }
  }

  detectChange(srcFile, dstFile, content=undefined) {
    try {
      if ((srcFile == undefined || !fs.existsSync(srcFile)) && content == undefined) throw "unexpected";
      if (srcFile == undefined || !fs.existsSync(dstFile)) return true; // change is needed
      if (content && content != fs.readFileSync( dstFile, 'utf-8'))
        return true;
      const srcStats = fs.lstatSync(srcFile);
      const dstStats = fs.lstatSync(dstFile);
      return srcStats.mtime > dstStats.mtime;
    } catch (error) {
      console.error('Error checking file timestamps:', error);
      process.exit(-1)
      return false;
    }
  }

  writeFileIfChanged(srcFile, dstFile, content, type = 'utf-8') {
    if (this.detectChange(srcFile, dstFile, content)) {
      if (!nonDestructive)
        fs.writeFileSync(dstFile, content, type)
      console.log(`✅ Converted: ${srcFile} → ${dstFile}`);
      syncer.markWritten( dstFile )
    } else {
      VERBOSE && console.log(`✅ No Change: ${srcFile ? srcFile : "[content]"} → ${dstFile}`);
      syncer.markWritten( dstFile, true )
    }
  }

  copyFileIfChanged(srcFile, dstFile) {
    if (this.detectChange(srcFile, dstFile)) {
      if (!nonDestructive)
        fs.copyFileSync(srcFile, dstFile)
      console.log(`📁 Copied: ${srcFile} → ${dstFile}`);
      syncer.markWritten( dstFile )
    } else {
      VERBOSE && console.log(`📁 No Change: ${srcFile} → ${dstFile}`);
      syncer.markWritten( dstFile, true )
    }
  }

  setChmodIfNeeded(filePath, desiredPermissions = 0o755) {
    try {
      const stats = fs.statSync(filePath);
      const currentPermissions = stats.mode & desiredPermissions; // to octal
      if (currentPermissions !== desiredPermissions) {
        if (!nonDestructive)
          fs.chmodSync(filePath, desiredPermissions);
        console.log(`✅ Set: Permissions for ${filePath} updated to ${desiredPermissions.toString(8)}`);
      } else {
        VERBOSE && console.log(`✅ No Change: Permissions for ${filePath} are already set to ${desiredPermissions.toString(8)}`);
      }
    } catch (error) {
      console.error('Error setting permissions:', error);
    }
  }

  getFileTimestamp(filePath) {
    try {
      const stats = fs.statSync(filePath);
      return new Date(stats.mtime);
    } catch (error) {
      console.error('Error getting file timestamp:', error);
      return null;
    }
  }

  // close at the end, it will clean out / delete any unwritten files from your destination
  close() {
    console.log( "[SyncToFileSystem] closing,",
                "generated", Object.keys(this.inventory).filter(r => this.inventory[r] == true).length,
                "skipped", Object.keys(this.inventory).filter(r => this.inventory[r] == 3).length,
                "will delete", Object.keys(this.inventory).filter(r => this.inventory[r] == false).length )
    for (const file in this.inventory) {
      if (!this.inventory[file]) {
        if (!nonDestructive)
          fs.unlinkSync(path.join(this.destination, file));
        console.log( "[SyncToFileSystem] Removing: ", path.join(this.destination, file) )
      }
    }
  }
}

// helper for recursive copy (todo: move this into the syncer?)
function copyFolder(indir, outdir, options = { recurse: true }) {
  const relative_dir = path.basename(indir) // final sourcedir will match the destdir...
  const dirSrc = path.join(__dirname, relative_dir);
  const dirDest = path.join(outdir, relative_dir);

  if (!fs.existsSync(dirSrc)) {
    console.warn(`⚠️  No dir:'${relative_dir}' found to copy.`);
    return;
  }

  const copyRecursiveSync = (src, dest) => {
    if (!fs.existsSync(dest)) {
      if (!nonDestructive) {
        fs.mkdirSync(dest, { recursive: true });
      }
      console.log(`📁 Created dir: ${dest}`);
    }

    fs.readdirSync(src).forEach(item => {
      const srcPath = path.join(src, item);
      const destPath = path.join(dest, item);

      const stat = fs.lstatSync(srcPath); // use lstat to detect symlinks

      if (stat.isDirectory()) {
        if (options.recurse)
          copyRecursiveSync(srcPath, destPath);
        //console.log(`📁 Copied dir:'${relative_dir}': ${srcPath} → ${destPath}`);
      } else {
        const isSymlink = stat.isSymbolicLink();
        try {
          fs.realpathSync(srcPath)
        } catch (error) {
          console.log( `looks like perhaps "${srcPath}" symlink no longer points at a file (maybe you need to relink that symlink?)`, error )
          return
        }
        const realSrcPath = isSymlink ? fs.realpathSync(srcPath) : srcPath;
        const realStat = fs.statSync(realSrcPath);
        if (realStat.isDirectory()) {
          // Handle symlinked directory: recurse instead of copying like a file
          if (options.recurse)
            copyRecursiveSync(realSrcPath, destPath);
          //console.log(`📁 Copied dir:'${relative_dir}': ${srcPath} → ${destPath}`);
        } else {
          syncer.copyFileIfChanged(realSrcPath, destPath);
        }
      }
    });
  };

  copyRecursiveSync(dirSrc, dirDest);
};


function makeDir( outputDir ) {
  if (!fs.existsSync(outputDir)) {
    if (!nonDestructive) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    console.log(`📸 Create: ${outputDir}`);
  } else {
    VERBOSE && console.log(`⏩ Skipped (already created): ${outputDir}`);
  }
}

// reset the output dir only if we're forcing it... otherwise enjoy minimal changes from the syncer.
if (forceRegen && fs.existsSync(outputDir)) {
  if (!nonDestructive)
    fs.rmSync(outputDir, { recursive: true, force: true });
}
makeDir( outputDir )

// track files for a minimal sync/change to outputDir
let syncer = new SyncToFileSystem( outputDir );

// create dirs
const uploadsDir = path.join(outputDir, `${SETTINGS.WIKI_ENDPOINT}/uploads` );
makeDir( uploadsDir )
const viewDir = path.join(outputDir, `${SETTINGS.WIKI_ENDPOINT}/view` );
makeDir( viewDir )
const mdDir = path.join(outputDir, `${SETTINGS.WIKI_ENDPOINT}/markdown` );
makeDir( mdDir )

// Convert .md files to .html, copy image files
fs.readdirSync(inputDir).forEach(file => {
  const topic = path.basename(file, '.md');
  const fullPath = path.join(inputDir, file);
  const ext = path.extname(file).toLowerCase();

  // Skip versioned .md files
  if (ext === '.md' && /^[^.]+\.md$/.test(file)) {
    const outputFileName = topic;
    const outputPath = path.join(viewDir, outputFileName);
    let markdown = fs.readFileSync(fullPath, 'utf-8');

    // special case: sanitize ChangeLog.md for static consumption
    if (topic == "ChangeLog") {
      markdown = markdown.replace( /\[(v\d+)\]\([^)]+\)/g, '$1' )
    }

    const req = new Req(topic);
    const html = wrapWithFrame( markdownToHtml(markdown, "/wiki/view", {
      link_relative_callback: (baseUrl, link_topic) => `${baseUrl}/${link_topic}`,
      link_absolute_callback: (baseUrl, url) => url,
      userdata: SETTINGS.USERS_WHITELIST,
    }), topic, req, syncer.getFileTimestamp(fullPath) );
    syncer.writeFileIfChanged( fullPath, outputPath, html, 'utf-8' )                                  // copy the topic html over
    syncer.writeFileIfChanged( fullPath, path.join(mdDir, outputFileName + ".md"), markdown, 'utf8' ) // copy the topic.md over

    // special case: webservers may need there to be a index.html
    // if (topic == "index")
    //   syncer.writeFileIfChanged( fullPath, outputPath + '.html', html, 'utf-8' )
  }

  // Copy images
  const image_types = [ '.jpg', '.png', '.jpeg', '.gif', '.svg' ]
  if (image_types.includes( ext )) {
    const outputPath = path.join(uploadsDir, file)
    syncer.copyFileIfChanged(fullPath, outputPath)
  }
});

// Copy assets
copyFolder( SETTINGS.ASSETS_DIR, outputDir, { recurse: true } )

// Copy torrents
copyFolder( SETTINGS.TORRENT_DIR, outputDir, { recurse: false } )

// Copy uploads
copyFolder( SETTINGS.WIKI_FILES_DIR, outputDir, { recurse: false } )

// write out build/serve.sh
const serveScriptPath = path.join(outputDir, "serve.sh")
syncer.writeFileIfChanged(undefined, serveScriptPath, "#!/bin/bash\npython -m http.server", "utf8")
syncer.setChmodIfNeeded(serveScriptPath, 0o755)

// write out robots.txt
const robotsTxtPath = path.join(outputDir, "robots.txt")
syncer.writeFileIfChanged(undefined, robotsTxtPath, `User-agent: *
Disallow:`)

// write out sitemap.xml
const sitemapXmlPath = path.join(outputDir, "sitemap.xml")
require( `./sitemap.js` ).siteMap( "https://" + SETTINGS.DOMAINS[1] ).then( sitemap_xml => {
  syncer.writeFileIfChanged(undefined, sitemapXmlPath, sitemap_xml )
})

// write out search
const searchPath = path.join(outputDir, "wiki/search")
const searchHTML = require( `./router-wiki.js` ).buildPageSearch( new Req("search", "/wiki", "/") )
syncer.writeFileIfChanged(undefined, searchPath, searchHTML )

// write out search-youtube
const searchYoutubePath = path.join(outputDir, "wiki/search-youtube")
const searchYoutubeHTML = require( `./router-wiki.js` ).buildPageSearch( new Req("search-youtube", "/wiki", "/" ) )
syncer.writeFileIfChanged(undefined, searchYoutubePath, searchYoutubeHTML )

// write out greek/quizzes
makeDir( path.join(outputDir, "greek") )
const quizzesPath = path.join(outputDir, "greek/quizzes")
const quizzesHTML = require( `./router-quiz.js` ).buildPage_quizzes( new Req("quizzes", "/greek", "/" ), "quizzes" )
syncer.writeFileIfChanged(undefined, quizzesPath, quizzesHTML )

// write out the rss
const req = new Req("index")
const rssPath = path.join(outputDir, "rss")
syncer.writeFileIfChanged( undefined, rssPath, makeRSS( `${req.protocol}://${req.get('host')}/rss`, SETTINGS.TORRENT_DIR ), "utf8" )

function genRedirectPage(link) {
  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta http-equiv="refresh"   content="0; url=${link}">
    <meta property="og:url"      content="${link}">
    <meta property="twitter:url" content="${link}">
    <title>Redirecting…</title>
  </head>
  <body>
    <p>If you are not redirected, <a href="${link}">click here</a>.</p>
  </body>
</html>
`
}
// mechanical stuff
makeDir( path.join(outputDir, "root/wiki/view") )
syncer.writeFileIfChanged(undefined, path.join(outputDir, "root/forbidden.html"), "403 forbidden" )
syncer.writeFileIfChanged(undefined, path.join(outputDir, "root/notfound.html"), "404 not found" )
syncer.writeFileIfChanged(undefined, path.join(outputDir, "root/index.html"), genRedirectPage( `https://${SETTINGS.DOMAINS[1]}/wiki/view/index` ) )
syncer.writeFileIfChanged(undefined, path.join(outputDir, "root/wiki/index.html"), genRedirectPage( `https://${SETTINGS.DOMAINS[1]}/wiki/view/index` ) )
syncer.writeFileIfChanged(undefined, path.join(outputDir, "root/wiki/view/index.html"), genRedirectPage( `https://${SETTINGS.DOMAINS[1]}/wiki/view/index` ) )


// done, delete any differences in the destination dir.
syncer.close()
