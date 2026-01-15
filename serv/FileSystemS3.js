const AWS = require('aws-sdk');
const { PassThrough } = require('stream');
const { normalizePath, DirentLike, StatsLike, runSync } = require('./FileSystemUtils');

class FileSystemS3 {
  constructor(options = {}) {
    this.driverName = 's3';
    this.bucket = options.bucket || process.env.FILESYSTEM_S3_BUCKET;
    if (!this.bucket) {
      throw new Error('FileSystemS3 requires FILESYSTEM_S3_BUCKET to be set.');
    }
    this.prefix = (options.prefix || process.env.FILESYSTEM_S3_PREFIX || '').replace(/^\//, '').replace(/\/$/, '');
    const region = options.region || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
    this.s3 = new AWS.S3({ region });

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

  // Helpers -------------------------------------------------------------------
  _key(filePath) {
    const normalized = normalizePath(filePath);
    if (!normalized && !this.prefix) return '';
    if (!normalized) return this.prefix;
    return this.prefix ? `${this.prefix}/${normalized}` : normalized;
  }

  _dirKey(dirPath) {
    let key = this._key(dirPath);
    if (key && !key.endsWith('/')) key += '/';
    return key;
  }

  _wrapError(err, targetPath) {
    if (err && (err.code === 'NoSuchKey' || err.code === 'NotFound')) {
      const enoent = new Error(`ENOENT: no such file or directory, open '${targetPath}'`);
      enoent.code = 'ENOENT';
      enoent.path = targetPath;
      return enoent;
    }
    return err;
  }

  async _headObject(key) {
    try {
      const res = await this.s3
        .headObject({
          Bucket: this.bucket,
          Key: key,
        })
        .promise();
      return res;
    } catch (err) {
      throw this._wrapError(err, key);
    }
  }

  async _listObjects(prefix) {
    const res = await this.s3
      .listObjectsV2({
        Bucket: this.bucket,
        Prefix: prefix,
        Delimiter: '/',
      })
      .promise();
    return res;
  }

  _direntFromList(files, dirs, options) {
    if (options && options.withFileTypes) {
      return [
        ...files.map(name => new DirentLike(name, 'file')),
        ...dirs.map(name => new DirentLike(name, 'dir')),
      ];
    }
    return [...files, ...dirs];
  }

  _runSync(fn) {
    return runSync(fn);
  }

  // Core ops ------------------------------------------------------------------
  async readFile(filePath, options) {
    const key = this._key(filePath);
    try {
      const res = await this.s3
        .getObject({
          Bucket: this.bucket,
          Key: key,
        })
        .promise();
      if (typeof options === 'string') {
        return res.Body.toString(options);
      }
      if (options && options.encoding) {
        return res.Body.toString(options.encoding);
      }
      return res.Body;
    } catch (err) {
      throw this._wrapError(err, filePath);
    }
  }
  readFileSync(filePath, options) {
    return this._runSync(() => this.readFile(filePath, options));
  }

  async writeFile(filePath, data, options = {}) {
    const key = this._key(filePath);
    const body = Buffer.isBuffer(data) || data instanceof Uint8Array ? data : Buffer.from(data, options.encoding || 'utf8');
    await this.s3
      .putObject({
        Bucket: this.bucket,
        Key: key,
        Body: body,
      })
      .promise();
  }
  writeFileSync(filePath, data, options) {
    return this._runSync(() => this.writeFile(filePath, data, options));
  }

  async appendFile(filePath, data, options = {}) {
    let existing = '';
    if (await this.exists(filePath)) {
      existing = await this.readFile(filePath, { encoding: options.encoding || 'utf8' });
    }
    const combined = existing + data;
    await this.writeFile(filePath, combined, options);
  }
  appendFileSync(filePath, data, options) {
    return this._runSync(() => this.appendFile(filePath, data, options));
  }

  async readdir(dirPath = '.', options = {}) {
    const prefix = this._dirKey(dirPath);
    const res = await this._listObjects(prefix);
    const files = [];
    for (const obj of res.Contents || []) {
      if (obj.Key === prefix) continue;
      const remainder = obj.Key.slice(prefix.length);
      if (remainder.includes('/')) continue;
      if (remainder) files.push(remainder);
    }
    const dirs = (res.CommonPrefixes || []).map(p => {
      const remainder = p.Prefix.slice(prefix.length).replace(/\/$/, '');
      return remainder;
    });
    return this._direntFromList(files, dirs, options);
  }
  readdirSync(dirPath, options) {
    return this._runSync(() => this.readdir(dirPath, options));
  }

  async mkdir(dirPath, options = { recursive: true }) {
    if (options && options.recursive) {
      return; // S3 directories are virtual.
    }
    const key = this._dirKey(dirPath);
    await this.s3
      .putObject({
        Bucket: this.bucket,
        Key: key,
        Body: '',
      })
      .promise();
  }
  mkdirSync(dirPath, options) {
    return this._runSync(() => this.mkdir(dirPath, options));
  }
  async ensureDir(dirPath) {
    await this.mkdir(dirPath, { recursive: true });
  }
  ensureDirSync(dirPath) {
    return this.mkdirSync(dirPath, { recursive: true });
  }

  async stat(filePath) {
    const key = this._key(filePath);
    try {
      const res = await this._headObject(key);
      return new StatsLike({
        size: res.ContentLength || 0,
        mtime: res.LastModified || new Date(),
        isDirectory: false,
      });
    } catch (err) {
      if (err.code === 'ENOENT') {
        const dirKey = this._dirKey(filePath);
        const listing = await this._listObjects(dirKey);
        if ((listing.Contents && listing.Contents.length > 0) || (listing.CommonPrefixes && listing.CommonPrefixes.length > 0)) {
          return new StatsLike({
            size: 0,
            mtime: new Date(),
            isDirectory: true,
          });
        }
      }
      throw this._wrapError(err, filePath);
    }
  }
  statSync(filePath) {
    return this._runSync(() => this.stat(filePath));
  }

  async lstat(filePath) {
    return this.stat(filePath);
  }
  lstatSync(filePath) {
    return this._runSync(() => this.lstat(filePath));
  }

  async rename(oldPath, newPath) {
    await this.copyFile(oldPath, newPath);
    await this.unlink(oldPath);
  }
  renameSync(oldPath, newPath) {
    return this._runSync(() => this.rename(oldPath, newPath));
  }

  async copyFile(srcPath, destPath) {
    const copySource = `${this.bucket}/${this._key(srcPath)}`;
    await this.s3
      .copyObject({
        Bucket: this.bucket,
        Key: this._key(destPath),
        CopySource: encodeURI(copySource),
      })
      .promise();
  }
  copyFileSync(srcPath, destPath) {
    return this._runSync(() => this.copyFile(srcPath, destPath));
  }

  async unlink(filePath) {
    const key = this._key(filePath);
    await this.s3
      .deleteObject({
        Bucket: this.bucket,
        Key: key,
      })
      .promise();
  }
  unlinkSync(filePath) {
    return this._runSync(() => this.unlink(filePath));
  }

  async rm(targetPath, options = {}) {
    if (options.recursive) {
      const prefix = this._dirKey(targetPath);
      let continuationToken;
      do {
        const res = await this.s3
          .listObjectsV2({
            Bucket: this.bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          })
          .promise();
        if (res.Contents && res.Contents.length > 0) {
          await this.s3
            .deleteObjects({
              Bucket: this.bucket,
              Delete: {
                Objects: res.Contents.map(obj => ({ Key: obj.Key })),
              },
            })
            .promise();
        }
        continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (continuationToken);
      return;
    }
    await this.unlink(targetPath);
  }
  rmSync(targetPath, options) {
    return this._runSync(() => this.rm(targetPath, options));
  }

  async rmdir(dirPath, options) {
    return this.rm(dirPath, { recursive: options && options.recursive });
  }
  rmdirSync(dirPath, options) {
    return this._runSync(() => this.rmdir(dirPath, options));
  }

  async access(filePath) {
    await this.stat(filePath);
  }
  accessSync(filePath) {
    return this._runSync(() => this.access(filePath));
  }

  async exists(filePath) {
    try {
      await this.access(filePath);
      return true;
    } catch (err) {
      if (err && err.code === 'ENOENT') return false;
      throw err;
    }
  }
  existsSync(filePath) {
    return this._runSync(() => this.exists(filePath));
  }

  async chmod() {
    // Not applicable in S3; no-op.
  }
  chmodSync() {
    return;
  }

  createReadStream(filePath, options = {}) {
    const key = this._key(filePath);
    const params = {
      Bucket: this.bucket,
      Key: key,
    };
    if (options && (options.start !== undefined || options.end !== undefined)) {
      const start = options.start || 0;
      const end = options.end !== undefined ? options.end : '';
      params.Range = `bytes=${start}-${end}`;
    }
    const stream = this.s3.getObject(params).createReadStream();
    return stream;
  }

  createWriteStream(filePath, options = {}) {
    const pass = new PassThrough();
    this.s3
      .upload({
        Bucket: this.bucket,
        Key: this._key(filePath),
        Body: pass,
        ContentType: options.contentType,
      })
      .promise()
      .catch(err => {
        pass.emit('error', err);
      });
    return pass;
  }
}

module.exports = FileSystemS3;
