#!/usr/bin/env node
/**
 * FileSystem abstraction smoke tests.
 * Usage: node serv/FileSystemTests.js [--type=local|s3] [--root=/tmp/foo]
 */

const path = require('path');
const os = require('os');
const assert = require('assert');
const { once } = require('events');

const ARG_PREFIX = '--';
const DEFAULT_TYPE = 'local';
const DEFAULT_BASE = path.join(os.tmpdir(), 'soma_filesystem_tests');

function parseArgs(argv) {
  const args = { type: DEFAULT_TYPE, root: null };
  argv.forEach(arg => {
    if (!arg.startsWith(ARG_PREFIX)) return;
    const [key, value = ''] = arg.slice(ARG_PREFIX.length).split('=');
    if (key === 'type' && value) {
      args.type = value.toLowerCase();
    } else if (key === 'root' && value) {
      args.root = value;
    }
  });
  return args;
}

function createDriver(type) {
  const lookup = {
    local: './FileSystemLocal',
    s3: './FileSystemS3',
  };
  const modulePath = lookup[type] || lookup.local;
  const Driver = require(modulePath);
  return new Driver();
}

function uniqueTestDir(baseDir) {
  const suffix = `_____tests_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return path.join(baseDir, suffix);
}

function removeTree(driver, targetPath) {
  if (!driver.existsSync || !driver.existsSync(targetPath)) return;
  const stat = driver.statSync(targetPath);
  if (stat.isDirectory()) {
    const entries = driver.readdirSync(targetPath);
    entries.forEach(entry => removeTree(driver, path.join(targetPath, entry)));
    driver.rmdirSync(targetPath);
  } else {
    driver.unlinkSync(targetPath);
  }
}

function setupCleanup(driver, rootDir) {
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try {
      removeTree(driver, rootDir);
    } catch (err) {
      console.warn(`[cleanup] failed for ${rootDir}: ${err.message}`);
    }
  };

  const makeHandler = (signal, exitCode) => () => {
    console.warn(`Received ${signal}, cleaning up ${rootDir}`);
    cleanup();
    process.exit(exitCode);
  };

  process.once('SIGINT', makeHandler('SIGINT', 130));
  process.once('SIGTERM', makeHandler('SIGTERM', 143));
  process.once('exit', cleanup);

  return cleanup;
}

async function runTests(driver, rootDir) {
  const results = [];

  const log = (msg) => {
    results.push(msg);
    console.log(msg);
  };

  driver.ensureDirSync(rootDir, { recursive: true });
  log(`[init] using root ${rootDir}`);

  const fileA = path.join(rootDir, 'alpha.txt');
  const fileB = path.join(rootDir, 'beta.txt');
  const dirC = path.join(rootDir, 'nested');
  const fileC = path.join(dirC, 'gamma.txt');
  const streamFile = path.join(rootDir, 'stream.bin');

  // Sync write/read
  driver.writeFileSync(fileA, 'alpha', 'utf8');
  assert.strictEqual(driver.readFileSync(fileA, 'utf8'), 'alpha');
  log('[sync] write/read ok');

  // Async write/read/append
  await driver.promises.appendFile(fileA, ' bravo', 'utf8');
  const asyncRead = await driver.promises.readFile(fileA, 'utf8');
  assert.strictEqual(asyncRead, 'alpha bravo');
  log('[async] append/read ok');

  // mkdir + ensureDir + readdir
  await driver.promises.mkdir(dirC, { recursive: true });
  driver.writeFileSync(fileC, 'nested', 'utf8');
  const entries = driver.readdirSync(rootDir);
  assert(entries.includes(path.basename(dirC)));
  log('[dir] mkdir/readdir ok');

  // rename + stat
  driver.renameSync(fileA, fileB);
  const stat = driver.statSync(fileB);
  assert(stat.isFile(), 'renamed file should exist');
  log('[meta] rename/stat ok');

  // streams
  await new Promise((resolve, reject) => {
    const ws = driver.createWriteStream(streamFile);
    ws.on('error', reject);
    ws.on('finish', resolve);
    ws.end(Buffer.from('stream-data'));
  });
  const collected = await new Promise((resolve, reject) => {
    const rs = driver.createReadStream(streamFile);
    const chunks = [];
    rs.on('data', chunk => chunks.push(chunk));
    rs.on('error', reject);
    rs.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
  assert.strictEqual(collected, 'stream-data');
  log('[stream] read/write ok');

  // watch (best effort)
  // delete + cleanup
  const safeRemove = (fn) => {
    try {
      fn();
    } catch (err) {
      if (!err || err.code !== 'ENOENT') throw err;
    }
  };

  safeRemove(() => driver.unlinkSync(fileB));
  safeRemove(() => driver.unlinkSync(streamFile));
  safeRemove(() => driver.unlinkSync(fileC));
  safeRemove(() => driver.rmdirSync(dirC));
  log('[cleanup] files removed');
}

async function main() {
  let cleanup = () => {};
  try {
    const args = parseArgs(process.argv.slice(2));
    const driver = createDriver(args.type);
    const baseRoot = args.root ? path.resolve(args.root) : DEFAULT_BASE;
    const rootDir = uniqueTestDir(baseRoot);

    driver.ensureDirSync(baseRoot, { recursive: true });
    cleanup = setupCleanup(driver, rootDir);

    await runTests(driver, rootDir);
    cleanup();
    console.log('All tests passed');
    process.exit(0);
  } catch (err) {
    try {
      cleanup();
    } catch (cleanupErr) {
      console.warn(`[cleanup] secondary failure: ${cleanupErr.message}`);
    }
    console.error('FileSystemTests failed:', err.message);
    if (process.env.DEBUG) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

main();
