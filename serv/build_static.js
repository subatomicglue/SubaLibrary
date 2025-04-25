#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const express = require("express");
const router = express.Router();
const sanitizer = require('./sanitizer');
const sanitize = sanitizer.sanitize;
const template = require('./template');
const { markdownToHtml } = require('./markdown');

const SETTINGS = require('./settings');

const args = process.argv.slice(2);
const nonDestructive = args.includes('--non-destructive');

const inputDir = SETTINGS.WIKI_DIR;
const outputDir = path.join(__dirname, 'build');

// generate .html file.
function wrapWithFrame(content, topic, req) {
  class Req {
    constructor( topic ) {
      this.originalUrl = "/"+topic+".html"
      this.canonicalUrl = `${this.protocol}://${this.get('host')}${this.originalUrl}`;
      this.canonicalUrlRoot = `${this.protocol}://${this.get('host')}`;
      this.canonicalUrlDomain = `${this.get('host')}`;
      this.user = "---"
    }
    get(str) { return { host: SETTINGS.DOMAINS[0] }[str] } // assume the first DOMAIN[] is the one
    protocol = "https"
    originalUrl = "/"
    baseUrl = ""
  }
  req = new Req(topic);

  return template.file( "page.template.html", {
    ...SETTINGS, ...{ CANONICAL_URL: req.canonicalUrl, CANONICAL_URL_ROOT: req.canonicalUrlRoot, CANONICAL_URL_DOMAIN: req.canonicalUrlDomain, CURRENT_DATETIME: (new Date()).toISOString().replace(/\.\d{3}Z$/, '+0000') },
    SOCIAL_TITLE: `${SETTINGS.TITLE}${(topic != "index") ? ` - ${topic}` : ""}`,
    BACKBUTTON_PATH: `/`,
    ASSETS_MAGIC: "assets",
    BACKBUTTON_VISIBILITY: `visible`,//`hidden`,
    BACKBUTTON_IMAGE: `/assets/home_24dp_E3E3E3_FILL0_wght400_GRAD0_opsz24.svg`,
    PAGE_TITLE: `<a href="/">/</a>${topic}`,
    USER: `${req.user}`,
    SCROLL_CLASS: "scroll-child-wiki",
    WHITESPACE: "normal",
    BODY: `<div style="padding-left: 2em;padding-right: 2em;padding-top: 1em;padding-bottom: 1em;">${content}</div>`,
    USER_LOGOUT: `<a style="color: grey;" href="https://dragons.hypatiagnostikoi.com/login">&nbsp;signin</a>`,
    SEARCH: `<a href="https://dragons.hypatiagnostikoi.com/wiki/search"><img src="/assets/search_24dp_E3E3E3_FILL0_wght400_GRAD0_opsz24.svg"/></a>`,
  })
}

function copyFolder(dir) {
  const relative_dir = path.basename(dir)
  const dirSrc = path.join(__dirname, relative_dir);
  const assetsDest = path.join(outputDir, relative_dir);

  if (!fs.existsSync(dirSrc)) {
    console.warn(`⚠️  No dir:'${relative_dir}' found to copy.`);
    return;
  }

  const copyRecursiveSync = (src, dest) => {
    if (!fs.existsSync(dest)) {
      if (!nonDestructive) {
        fs.mkdirSync(dest, { recursive: true });
      }
      console.log(`📁 Created dir:'${relative_dir}': ${dest}`);
    }

    fs.readdirSync(src).forEach(item => {
      const srcPath = path.join(src, item);
      const destPath = path.join(dest, item);

      const stat = fs.lstatSync(srcPath); // use lstat to detect symlinks

      if (stat.isDirectory()) {
        copyRecursiveSync(srcPath, destPath);
        //console.log(`📁 Copied dir:'${relative_dir}': ${srcPath} → ${destPath}`);
      } else {
        const isSymlink = stat.isSymbolicLink();
        const realSrcPath = isSymlink ? fs.realpathSync(srcPath) : srcPath;
        const realStat = fs.statSync(realSrcPath);
        if (realStat.isDirectory()) {
          // Handle symlinked directory: recurse instead of copying like a file
          copyRecursiveSync(realSrcPath, destPath);
          //console.log(`📁 Copied ${isSymlink ? "symlink " : ""}dir:'${relative_dir}': ${srcPath} → ${destPath}`);
        } else {
          if (!nonDestructive)
            fs.copyFileSync(realSrcPath, destPath);
          console.log(`📁 Copied ${isSymlink ? "symlink " : ""}file:'${relative_dir}': ${srcPath} → ${destPath}`);
        }
      }
    });
  };

  copyRecursiveSync(dirSrc, assetsDest);
};

// remove the output dir
if (fs.existsSync(outputDir)) {
  fs.rmSync(outputDir, { recursive: true, force: true });
}

function makeDir( outputDir ) {
  if (!fs.existsSync(outputDir)) {
    if (!nonDestructive) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    console.log(`📸 Create: ${outputDir}`);
  } else {
    console.log(`⏩ Skipped (already created): ${outputDir}`);
  }
}

// create the output dirs
makeDir( outputDir )
makeDir( path.join( outputDir, `${SETTINGS.WIKI_ENDPOINT}/uploads`) )

// Convert .md files to .html, copy image files
fs.readdirSync(inputDir).forEach(file => {
  const fullPath = path.join(inputDir, file);
  const ext = path.extname(file).toLowerCase();

  // Skip versioned .md files
  if (ext === '.md' && /^[^.]+\.md$/.test(file)) {
    const outputFileName = path.basename(file, '.md') + '.html';
    const outputPath = path.join(outputDir, outputFileName);
    const markdown = fs.readFileSync(fullPath, 'utf-8');
    const html = wrapWithFrame( markdownToHtml(markdown, "", {
      link_relative_callback: (baseUrl, url) => `${baseUrl}/${url}.html`,
      link_absolute_callback: (baseUrl, url) => url,
    }), path.basename(file, '.md'), {});
    if (!nonDestructive) {
      fs.writeFileSync(outputPath, html, 'utf-8');
    }
    console.log(`✅ Converted: ${file} → ${outputPath}`);
  }

  // Copy images
  const image_types = [ '.jpg', '.png', '.jpeg', '.gif', '.svg' ]
  if (image_types.includes( ext )) {
    const outputPath = path.join(path.join( outputDir, `${SETTINGS.WIKI_ENDPOINT}/uploads`), file);
    if (!nonDestructive) {
      fs.copyFileSync(fullPath, outputPath);
    }
    console.log(`📸 Copied: ${file} → ${outputPath}`);
  }
});

// Copy assets
copyFolder( SETTINGS.ASSETS_DIR )

// write out build/serve.sh
const serveScriptPath = path.join(outputDir, "serve.sh");
fs.writeFileSync( serveScriptPath, "#!/bin/bash\npython -m http.server", "utf8" )
fs.chmodSync(serveScriptPath, 0o755);
