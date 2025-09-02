#!/usr/bin/env node
const https = require("https");
const path = require("path");
const fs = require("fs");
const cron = require("node-cron");
const { exec } = require("child_process");
const {
  LOGS_DIR,
} = require('./settings');

const CHECK_URL = "https://localhost/status";
const TIMEOUT_MS = 5000; // 5-second timeout
const RESTART_CMD = "npm run restart";

const winston = require('winston');
require('winston-daily-rotate-file');
// Ensure logs directory exists
fs.mkdirSync(LOGS_DIR, { recursive: true });

// Configure Winston Logger with Size-Based Log Rotation
const transport = new winston.transports.DailyRotateFile({
    filename: path.join(LOGS_DIR, 'server-%DATE%.log'),
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

logger.info( `[watchdog.js] Starting SomaServ watchdog ${new Date().toISOString()}` )

function checkService() {
  //console.log(`[watchdog.js] [${new Date().toISOString()}] Checking service...`);
  return new Promise((resolve, reject) => {
    let show_some_motion = 0;
    let status_handle  = setInterval( () => {
        logger.info( `[watchdog.js] Checking service...  Waiting ~${TIMEOUT_MS/1000}s for response... ${++show_some_motion}` )
    }, 1000 );

    const req = https.get(
      CHECK_URL,
      { rejectUnauthorized: false }, // ignore self-signed certs
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => { clearInterval( status_handle ); resolve({ status: res.statusCode, body: data })} );
      }
    );

    req.setTimeout(TIMEOUT_MS, () => {
      clearInterval( status_handle );
      logger.info(`[watchdog.js] Request timed out... failing in 3 seconds...`);
      let FAIL_TIMEOUT = 3;
      let count = FAIL_TIMEOUT;
      status_handle = setInterval( () => {
        logger.info( `[watchdog.js] After timeout, and about to fail in... ${--count}` )
      }, 1000 );
      setTimeout(() => {
        clearInterval( about_to_fail_interval );
        req.destroy();
        reject(new Error("Request timed out"));
      }, FAIL_TIMEOUT * 1000)
    });

    req.on("error", (err) => reject(err));
  });
}

function restartService() {
  console.log(`[watchdog.js] [${new Date().toISOString()}] Restarting service...`);
  exec(RESTART_CMD, (error, stdout, stderr) => {
    if (error) {
      console.error(`Restart failed: ${error.message}`);
      return;
    }
    if (stderr) console.error(`stderr: ${stderr}`);
    console.log(`stdout: ${stdout}`);
  });
}

// Schedule every minute
cron.schedule("* * * * *", async () => {
  //console.log(`[watchdog.js] [${new Date().toISOString()}] Checking service...`);
  try {
    const result = await checkService();
    //console.log(`[watchdog.js] Service responded with status: ${result.status}`);

    // 🚫 Ignore 404 responses
    if (result.status !== 404 && result.status >= 400) {
      console.error(`[watchdog.js] Unexpected error status: ${result.status}`);
      restartService();
    }
  } catch (err) {
    console.error(`[watchdog.js] Service check failed: ${err.message}`);
    restartService();
  }
});

