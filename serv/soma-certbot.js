#!/usr/bin/env node

const express = require('express');
const acme = require('acme-client');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const forge = require( 'node-forge' );
const winston = require('winston');
require('winston-daily-rotate-file');

///////////////////////////////////////////////////////
/////////////// CONFIG ////////////////////////////////
const config = require('./soma-serv.json');
const LOGS_DIR = config.LOGS_DIR
const CERT_DIR = path.resolve( config.CERTS_DIR );
const CERT_PATH = {
  privkey: path.join(CERT_DIR, config.CERT_KEY),
  cert: path.join(CERT_DIR, config.CERT_CRT)
};
const EMAIL = config.EMAIL
const DOMAINS = config.CERTBOT_DOMAINS || config.DOMAINS
///////////////////////////////////////////////////////


// Ensure logs directory exists
fs.mkdirSync(LOGS_DIR, { recursive: true });

// Configure Winston Logger with Size-Based Log Rotation
const transport = new winston.transports.DailyRotateFile({
  filename: path.join(LOGS_DIR, 'acme-%DATE%.log'),
  datePattern: 'YYYY-MM-DD', // Keeps separate files but with size limit
  maxSize: '5m',  // Each log file max 5MB
  maxFiles: '10', // Keep a maximum of 10 log files (i.e., ~50MB total storage)
  zippedArchive: true, // Compress old logs to save space
});

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: () => new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })
    }),
    //winston.format.timestamp(),
    winston.format.errors({ stack: true }), // Ensures stack traces are logged
    winston.format.json(),                                                // output json {"level":"info", "message":...., "timestamp":"3/18/2025, 10:46:13 AM"}
    winston.format.printf(({ level, message, label, timestamp }) => `${(level+":").toUpperCase().padEnd(6, " ")} [${message}]` ),
  ),
  transports: [transport, new winston.transports.Console()],
  exceptionHandlers: [transport, new winston.transports.Console()],
  rejectionHandlers: [transport, new winston.transports.Console()]
});


function getCertExpiration(certPath) {
  try {
    // logger.info(`[ACME] getCertExpiration: ${certPath}`);
    const certInfo = forge.pki.certificateFromPem(fs.readFileSync(certPath, 'utf8'));
    // logger.info(`[ACME] certInfo: ${JSON.stringify(certInfo)}`);
    const expiration = new Date(certInfo.validity.notAfter);
    return expiration;
  } catch (error) {
    logger.info(`[ACME] error: ${error}`);
    return null;
  }
}

function getCertDomains(certPath) {
  try {
    const certPem = fs.readFileSync(certPath, 'utf8');
    const cert = forge.pki.certificateFromPem(certPem);
    const domains = [];

    // Common Name (CN)
    const cn = cert.subject.getField('CN')?.value;
    if (cn) domains.push(cn);

    // Subject Alternative Names (SANs)
    const extensions = cert.extensions || [];
    const sanExt = extensions.find(ext => ext.name === 'subjectAltName');
    if (sanExt && Array.isArray(sanExt.altNames)) {
      for (const altName of sanExt.altNames) {
        if (altName.type === 2 && altName.value) { // DNS name
          if (!domains.includes(altName.value)) {
            domains.push(altName.value);
          }
        }
      }
    }

    return domains;
  } catch (error) {
    logger.info(`[ACME] Failed to extract domains: ${error}`);
    return [];
  }
}

function getMissingDomains(certPath, desiredDomains) {
  const certDomains = getCertDomains(certPath);
  const missing = desiredDomains.filter(domain => !certDomains.includes(domain));
  return missing;
}


const challengeMap = new Map();
const app = express();

// ACME challenge endpoint
app.get('/.well-known/acme-challenge/:token', (req, res) => {
  const keyAuth = challengeMap.get(req.params.token);
  if (!keyAuth) return res.status(404).end();
  logger.info(`[ACME] /.well-known/acme-challenge/${keyAuth}`)
  res.type('text/plain').send(keyAuth);
});

app.use((req, res, next) => {
  const host = req.headers.host;
  const httpsUrl = `https://${host}${req.url}`;
  res.redirect(302, httpsUrl);
});

// Certificate issuance logic
async function issueOrRenewCert() {
  const expiresAt = fs.existsSync(CERT_PATH.cert)
    ? getCertExpiration(CERT_PATH.cert)
    : null;

  //logger.info(`[ACME] exists ${fs.existsSync(CERT_PATH.cert)} ${getCertExpiration(CERT_PATH.cert)}`);

  if (expiresAt) {
    const domains = getCertDomains(CERT_PATH.cert)
    console.log("[soma-certbot] cert domains", domains);  
    console.log("[soma-certbot] desired domains", DOMAINS);
    const missing_domains = getMissingDomains( CERT_PATH.cert, DOMAINS )
    if (missing_domains.length > 0)
      console.log("[soma-certbot] is missing", missing_domains);
  
    const daysLeft = (expiresAt - new Date()) / (1000 * 60 * 60 * 24);
    if (daysLeft > 30 && missing_domains.length == 0) {
      logger.info(`[soma-certbot] Certificate expires in ${Math.ceil( daysLeft )} days, at: ${expiresAt.toISOString()}`);
      return;
    }
    logger.info(`[soma-certbot] Renewing certificate. Days left: ${Math.floor(daysLeft)}`);
  } else {
    logger.info('[soma-certbot] No certificate found. Creating new one...');
  }
  //return

  const client = new acme.Client({
    directoryUrl: process.env.ACME_STAGING === 'true' ? acme.directory.letsencrypt.staging : acme.directory.letsencrypt.production,
    accountKey: await acme.forge.createPrivateKey()
  });

  const [privateKey, csr] = await acme.forge.createCsr({
    commonName: DOMAINS[0],
    altNames: DOMAINS
  });

  const cert = await client.auto({
    csr,
    email: EMAIL,
    termsOfServiceAgreed: true,
    challengeCreateFn: async (_authz, challenge, keyAuthorization) => {
      challengeMap.set(challenge.token, keyAuthorization);
    },
    challengeRemoveFn: async (_authz, challenge, _keyAuthorization) => {
      challengeMap.delete(challenge.token);
    }
  });

  fs.mkdirSync(CERT_DIR, { recursive: true });
  fs.writeFileSync(CERT_PATH.privkey, privateKey);
  fs.writeFileSync(CERT_PATH.cert, cert);
  logger.info('[soma-certbot] Certificate saved.');
}

// Run cert check on startup and daily at 3am
issueOrRenewCert().catch(console.error);

//             ┌───────────── minute (0 - 59)    (or * for every minute)
//             │ ┌───────────── hour (0 - 23)
//             │ │ ┌───────────── day of the month (1 - 31)
//             │ │ │ ┌───────────── month (1 - 12)
//             │ │ │ │ ┌───────────── day of the week (0 - 7) (0 and 7 both represent Sunday)
//             │ │ │ │ │
cron.schedule('0 3 * * *', () => {
  issueOrRenewCert().catch(console.error);
});


logger.info(`[soma-certbot] starting with staging:${process.env.ACME_STAGING}`)
app.listen(80, () => {
  logger.info('[soma-certbot] Server running on port 80');
});
