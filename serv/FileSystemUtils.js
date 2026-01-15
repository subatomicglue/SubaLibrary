const path = require('path');

function normalizePath(filePath = '') {
  if (!filePath) return '';
  let normalized = filePath.replace(/\\/g, '/');
  normalized = path.posix.normalize(normalized);
  if (normalized.startsWith('./')) normalized = normalized.slice(2);
  if (normalized === '.') normalized = '';
  normalized = normalized.replace(/^\/+/, '');
  return normalized;
}

function runSync(promiseFactory) {
  const sab = new SharedArrayBuffer(4);
  const int32 = new Int32Array(sab);
  let result;
  let error;

  promiseFactory()
    .then(value => {
      result = value;
      Atomics.store(int32, 0, 1);
      Atomics.notify(int32, 0, 1);
    })
    .catch(err => {
      error = err;
      Atomics.store(int32, 0, 1);
      Atomics.notify(int32, 0, 1);
    });

  Atomics.wait(int32, 0, 0);

  if (error) throw error;
  return result;
}

class DirentLike {
  constructor(name, type = 'file') {
    this.name = name;
    this._type = type;
  }
  isFile() {
    return this._type === 'file';
  }
  isDirectory() {
    return this._type === 'dir';
  }
  isSymbolicLink() {
    return this._type === 'symlink';
  }
}

class StatsLike {
  constructor({ size = 0, mtime = new Date(), isDirectory = false }) {
    this.size = size;
    this.mtime = new Date(mtime);
    this.birthtime = this.mtime;
    this.ctime = this.mtime;
    this.atime = this.mtime;
    this._isDirectory = isDirectory;
  }
  isFile() {
    return !this._isDirectory;
  }
  isDirectory() {
    return this._isDirectory;
  }
  isSymbolicLink() {
    return false;
  }
}

module.exports = {
  normalizePath,
  runSync,
  DirentLike,
  StatsLike,
};
