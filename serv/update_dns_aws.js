#!/usr/bin/env node

const https = require('https');
const AWS = require('aws-sdk');

///////////////////////////////////////////////////////
/////////////// CONFIG ////////////////////////////////
const config = require('./soma-serv.json');
const HOSTED_ZONES = config.HOSTED_ZONES;
// [
//   {
//     HOSTED_ZONE_ID: '/hostedzone/Z012345ABC.....', // e.g., '/hostedzone/Z012345ABC...'
//     RECORD_NAME: 'blahblahblah.com.',              // A record to update (trailing dot required)
//   },
// ]
///////////////////////////////////////////////////////

const TTL = 300;                                     // Time to live in seconds
const args = process.argv.slice(2);
const showHelp = args.includes('--help');
const listZones = args.includes('--list');
const nonDestructive = args.includes('--non-destructive');
const forceUpdate = args.includes('--force');
const cloudFrontDistributionDomain = args.length > 0 && args[args.length-1].match( /cloudfront.net$/ ) ? args[args.length-1] : undefined

// === HELP TEXT ===
if (showHelp) {
  console.log(`
Usage: node update-a-record.js [--help] [--list] [--non-destructive] [optional: cloudFrontDistributionDomain e.g. dxxxxxxxxx.cloudfront.net]

Options:
  --help              Show this help message.
  --list              List Route53 hosted zones.
  --non-destructive   Show what would be done, but don't make changes.
  --force             Force update, even if IP hasn't changed.

Environment:
  Ensure AWS credentials are configured (via ~/.aws/credentials or environment variables).
  Update HOSTED_ZONE_ID and RECORD_NAME in the script.
`);
  process.exit(0);
}

function listHostedZones() {
  const route53 = new AWS.Route53();
  route53.listHostedZones({}, (err, data) => {
    if (err) {
      console.error('❌ Failed to list hosted zones:', err.message);
      process.exit(1);
    } else {
      console.log('📦 Hosted Zones:');
      data.HostedZones.forEach(zone => {
        console.log(`- ${zone.Name} (${zone.Id})`);
      });
    }
  });
}

// === LIST ZONES ===
if (listZones) {
  listHostedZones()
  return;
}

// === PUBLIC IP FETCH ===
function getPublicIP() {
  return new Promise((resolve, reject) => {
    https.get('https://api.ipify.org', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data.trim()));
    }).on('error', (err) => reject(err));
  });
}

// === CURRENT A RECORD LOOKUP ===
async function getCurrentARecord(route53, HOSTED_ZONE_ID, RECORD_NAME) {
  const params = {
    HostedZoneId: HOSTED_ZONE_ID,
    StartRecordName: RECORD_NAME,
    StartRecordType: 'A',
    MaxItems: '1'
  };

  try {
    const data = await route53.listResourceRecordSets(params).promise();
    const record = data.ResourceRecordSets.find(r =>
      r.Name === RECORD_NAME && r.Type === 'A'
    );

    return record && record.ResourceRecords.length > 0 ? record.ResourceRecords[0].Value : null;
  } catch (err) {
    console.error('❌ Error fetching current A record:', err.message);
    throw err;
  }
}

// === UPDATE RECORD ===
async function updateARecord(ip, cloudFrontDistributionDomain = undefined) {
  for (const zone of HOSTED_ZONES) {
    const { HOSTED_ZONE_ID, RECORD_NAME } = zone;
    const route53 = new AWS.Route53();
    const currentIP = await getCurrentARecord(route53, HOSTED_ZONE_ID, RECORD_NAME);
    console.log(`🔍 Current A record: ${currentIP || 'none'}`);

    if (!forceUpdate && currentIP === ip) {
      console.log(`✅ A record already up to date: ${ip}`);
      continue;
    }


    const params = cloudFrontDistributionDomain == undefined ? {
      HostedZoneId: HOSTED_ZONE_ID,
      ChangeBatch: {
        Comment: 'Auto-updated by dynamic DNS script',
        Changes: [
          {
            Action: 'UPSERT',
            ResourceRecordSet: {
              Name: RECORD_NAME,
              Type: 'A',
              TTL: TTL,
              ResourceRecords: [
                { Value: ip }
              ]
            }
          }
        ]
      }
    } : {
      HostedZoneId: HOSTED_ZONE_ID,
      ChangeBatch: {
        Comment: 'Auto-updated by dynamic DNS script',
        Changes: [
          {
            Action: 'UPSERT',
            ResourceRecordSet: {
              Name: RECORD_NAME, // Replace with your domain
              Type: 'A',
              AliasTarget: {
                HostedZoneId: 'Z2FDTNDATAQYW2', // CloudFront Hosted Zone ID
                DNSName: cloudFrontDistributionDomain,
                EvaluateTargetHealth: false,
              },
            },
          },
        ],
      },
    }

    if (nonDestructive) {
      console.log('🧪 Non-destructive mode enabled. Would send the following update:');
      console.log(JSON.stringify(params, null, 2));
      continue;
    }

    try {
      const result = await route53.changeResourceRecordSets(params).promise();
      console.log('✅ A record updated:', result.ChangeInfo.Id);
    } catch (err) {
      console.error('❌ Failed to update A record:', err.message);
      throw err;
    }
  }
}

// === MAIN ===
async function main() {
  try {
    const ip = await getPublicIP();
    console.log(`🌍 Public IP: ${ip}`);

    await updateARecord(ip, cloudFrontDistributionDomain);
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

main();

