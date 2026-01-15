const fs = require('fs');
const path = require('path');
const { DirentLike, StatsLike, runSync } = require('./FileSystemUtils');

class FileSystemLocal {
  constructor() {
    this.driverName = 'local';
    this.promises = {
      readFile: this.readFile.bind(this),
      writeFile: this.writeFile.bind(this),
      appendFile: this.appendFile.bind(this),
      readdir: this.readdir.bind(this),
      mkdir: this.mkdir.bind(this),
      stat: this.stat.bind(this),
      lstat: this.lstat.bind(this),
      unlink: this.unlink.bind(this),
      rm: this.rm.bind(this),
      rename: this.rename.bind(this),
      copyFile: this.copyFile.bind(this),
    };
  }

  // ---------------------------------------------------------------------------
  // Async helpers
  async readFile(filePath, options) {
    return fs.promises.readFile(filePath, options);
  }
  readFileSync(filePath, options) {
    return fs.readFileSync(filePath, options);
  }

  async writeFile(filePath, data, options) {
    return fs.promises.writeFile(filePath, data, options);
  }
  writeFileSync(filePath, data, options) {
    return fs.writeFileSync(filePath, data, options);
  }

  async appendFile(filePath, data, options) {
    return fs.promises.appendFile(filePath, data, options);
  }
  appendFileSync(filePath, data, options) {
    return fs.appendFileSync(filePath, data, options);
  }

  async readdir(dirPath, options) {
    const entries = await fs.promises.readdir(dirPath, options);
    return entries;
  }
  readdirSync(dirPath, options) {
    return fs.readdirSync(dirPath, options);
  }

  async mkdir(dirPath, options = { recursive: true }) {
    return fs.promises.mkdir(dirPath, options);
  }
  mkdirSync(dirPath, options = { recursive: true }) {
    return fs.mkdirSync(dirPath, options);
  }
  ensureDirSync(dirPath, options = { recursive: true }) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, options);
    }
  }
  async ensureDir(dirPath, options = { recursive: true }) {
    if (!(await this.exists(dirPath))) {
      await this.mkdir(dirPath, options);
    }
  }

  async stat(filePath) {
    return fs.promises.stat(filePath);
  }
  statSync(filePath) {
    return fs.statSync(filePath);
  }

  async lstat(filePath) {
    return fs.promises.lstat(filePath);
  }
  lstatSync(filePath) {
    return fs.lstatSync(filePath);
  }

  async rename(oldPath, newPath) {
    return fs.promises.rename(oldPath, newPath);
  }
  renameSync(oldPath, newPath) {
    return fs.renameSync(oldPath, newPath);
  }

  async unlink(filePath) {
    return fs.promises.unlink(filePath);
  }
  unlinkSync(filePath) {
    return fs.unlinkSync(filePath);
  }

  async rm(targetPath, options) {
    return fs.promises.rm(targetPath, options);
  }
  rmSync(targetPath, options) {
    return fs.rmSync(targetPath, options);
  }

  async rmdir(dirPath, options) {
    return fs.promises.rmdir(dirPath, options);
  }
  rmdirSync(dirPath, options) {
    return fs.rmdirSync(dirPath, options);
  }

  async copyFile(src, dest, flags) {
    return fs.promises.copyFile(src, dest, flags);
  }
  copyFileSync(src, dest, flags) {
    return fs.copyFileSync(src, dest, flags);
  }

  async access(filePath, mode) {
    return fs.promises.access(filePath, mode);
  }
  accessSync(filePath, mode) {
    return fs.accessSync(filePath, mode);
  }

  existsSync(filePath) {
    return fs.existsSync(filePath);
  }
  async exists(filePath) {
    try {
      await this.access(filePath, fs.constants.F_OK);
      return true;
    } catch (err) {
      return false;
    }
  }

  chmodSync(filePath, mode) {
    return fs.chmodSync(filePath, mode);
  }
  async chmod(filePath, mode) {
    return fs.promises.chmod(filePath, mode);
  }

  createReadStream(filePath, options) {
    return fs.createReadStream(filePath, options);
  }

  createWriteStream(filePath, options) {
    return fs.createWriteStream(filePath, options);
  }
}

module.exports = FileSystemLocal;
