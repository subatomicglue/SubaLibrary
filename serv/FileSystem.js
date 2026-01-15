const { FILESYSTEM_DRIVER } = require('./settings');
const FileSystemLocal = require('./FileSystemLocal');
const FileSystemS3 = require('./FileSystemS3');

const DRIVERS = {
  local: () => new FileSystemLocal(),
  s3: () =>
    new FileSystemS3({
      bucket: process.env.FILESYSTEM_S3_BUCKET,
      prefix: process.env.FILESYSTEM_S3_PREFIX,
      region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION,
    }),
};

function createDriver(name) {
  const normalized = (name || 'local').toLowerCase();
  const factory = DRIVERS[normalized] || DRIVERS.local;
  return factory();
}

module.exports = createDriver(FILESYSTEM_DRIVER);
