#!/usr/bin/env node

const AWS = require('aws-sdk');
const process = require('process');

const route53 = new AWS.Route53();
let nondestructive = false;


// Helper function to display help text
async function showHelp() {
  console.log(`
Usage: node update-cname.js --zone <HOSTED_ZONE_NAME> --records <RECORD_NAME1> <RECORD_NAME2> ...

Description:
This script adds or updates CNAME records in an AWS Route 53 hosted zone.

Arguments:
  --non-destructive dont make changes at AWS Route53, tell us what would have happened
  --zone            The Hosted Zone name for the DNS records (e.g., example.com.)
  --records         One or more CNAME records to create/update

Example:
  node update-host_aws.js --zone "example.com." --records "www" "api" "private"
  node update-host_aws.js --zone "example.com." --value "dxxxxxxxxxxxxx.cloudfront.net" --records "private" "private2"
  node update-host_aws.js --zone "example.com." --value "192.0.2.1" --records "private"

  NOTE: --records must always be the last arg
  `);

  await listHostedZones();
}

// Function to list all Route 53 hosted zones
async function listHostedZones() {
  try {
    const data = await route53.listHostedZones().promise();
    console.log('Hosted Zones:');
    data.HostedZones.forEach(zone => {
      console.log(`- ${zone.Name} (ID: ${zone.Id})`);
    });
    return data.HostedZones;
  } catch (err) {
    console.error('❌ Error fetching hosted zones:', err.message);
    process.exit(1);
  }
}

// Function to get the Hosted Zone ID from the name
async function getHostedZoneIdByName(zoneName) {
  try {
    const data = await route53.listHostedZones().promise();
    const hostedZone = data.HostedZones.find(zone => zone.Name === zoneName);
    if (hostedZone) {
      return hostedZone.Id;
    } else {
      throw new Error(`Hosted Zone with name ${zoneName} not found.`);
    }
  } catch (err) {
    console.error(`❌ Error fetching Hosted Zone ID: ${err.message}`);
    process.exit(1);
  }
}


// Function to get the existing CNAME record
async function recordGet(recordType = "CNAME", hostedZoneId, recordName) {
  try {
    const results = await route53.listResourceRecordSets({
      HostedZoneId: hostedZoneId,
      StartRecordName: recordName,
      StartRecordType: recordType,
      MaxItems: '1'
    }).promise()
    //console.log( `recordGet: for ${hostedZoneId} ${recordName}`, results );
    const result = results.ResourceRecordSets.filter( r => r.Name == `${recordName}.` && r.Type == recordType );

    //console.log( `recordGet: for ${recordType} ${hostedZoneId} ${recordName}`, result );

    return result.length > 0 ? result[0] : null;
  } catch (err) {
    console.error(`❌ Error fetching existing ${recordType} record:`, err);
    return null;
  }
}

async function recordCreate(recordType = "CNAME", hostedZoneId, targetName, targetValue) {
  console.log(` - Updating ${recordType} record for ${targetName} -> ${targetValue}:`);
  const params = {
    HostedZoneId: hostedZoneId,
    ChangeBatch: {
      Comment: `Add or update A record for ${targetName}`,
      Changes: [
        {
          Action: 'UPSERT',
          ResourceRecordSet: {
            Name: targetName,
            Type: recordType,
            TTL: 300,
            ResourceRecords: [{ Value: targetValue }]
          }
        }
      ]
    }
  };

  try {
    const result = nondestructive ? await wouldChangeRecord(recordType, hostedZoneId, recordName, targetName).willChange : await route53.changeResourceRecordSets(params).promise();
    console.log(`✅ ${recordType} record created or updated: ${targetName} -> ${targetValue}`);
  } catch (err) {
    console.error(`❌ Error creating/updating ${recordType} record:`, err);
  }
}

async function recordDelete(recordType = "CNAME", hostedZoneId, targetName) {
  let existingRecord = await recordGet(recordType, hostedZoneId, targetName);
  if (existingRecord) {
    //console.log( existingRecord );
    console.log(` - Deleting ${recordType} record for ${targetName} -> ${existingRecord.ResourceRecords.length > 0 ? existingRecord.ResourceRecords[0].Value : ""}:`);
    const params = {
      HostedZoneId: hostedZoneId,
      ChangeBatch: {
        Changes: [
          {
            Action: 'DELETE',
            ResourceRecordSet: {
              Name: targetName,
              Type: recordType,
              TTL: existingRecord.TTL,
              ResourceRecords: existingRecord.ResourceRecords
            }
          }
        ]
      }
    };
    try {
      const result = nondestructive ? await wouldChangeRecord(recordType, hostedZoneId, recordName, targetName, true).willChange : await route53.changeResourceRecordSets(params).promise();
      console.log(`✅ ${recordType} record deleted: ${targetName} -> ${existingRecord.ResourceRecords.length > 0 ? existingRecord.ResourceRecords[0].Value : ""}`);
    } catch (err) {
      console.error(`❌ Error deleting ${recordType} record:`, err);
    }
  }
}


async function wouldChangeRecord(recordType="CNAME", hostedZoneId, recordName, targetValue, toDelete=false) {
  try {
    const result = await route53.listResourceRecordSets({
      HostedZoneId: hostedZoneId,
      StartRecordName: recordName,
      StartRecordType: recordType,
      MaxItems: '1'
    }).promise();

    const existing = result.ResourceRecordSets[0];
    if (existing && toDelete) {
      return { willChange: true, reason: 'Would delete.' };
    }
    if (
      existing &&
      existing.Name === (recordName.endsWith('.') ? recordName : recordName + '.') &&
      existing.Type === recordType
    ) {
      const currentValue = existing.ResourceRecords[0]?.Value;
      if (currentValue === targetValue) {
        return { willChange: false, reason: 'No change needed, record already matches.' };
      } else {
        return { willChange: true, reason: `Would update value from '${currentValue}' to '${targetValue}'` };
      }
    } else {
      return { willChange: true, reason: 'Record does not exist and would be created.' };
    }
  } catch (err) {
    return { willChange: true, reason: `Error checking existing record: ${err.message}` };
  }
}

// Function to check if the value is an IP address
function isIPAddress(value) {
  const ipRegex = /^(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.((25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){2}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  return ipRegex.test(value);
}

// Function to create or update CNAME records
async function updateHostRecord(hostedZoneName, recordNames, hostedZoneValue=undefined) {
  const hostedZoneId = await getHostedZoneIdByName(hostedZoneName);

  for (const recordName of recordNames) {
    const targetValue = hostedZoneValue ? hostedZoneValue : `${hostedZoneName.replace(/\.$/,'')}`;
    const targetName = `${recordName}.${hostedZoneName.replace(/\.$/,'')}`;

    // If the value is an IP address, upsert an A record
    if (isIPAddress(targetValue)) {
      console.log(`Creating/updating A record for ${targetName} -> ${targetValue}:`);
      await recordDelete("CNAME", hostedZoneId, targetName);
      await recordCreate("A", hostedZoneId, targetName, targetValue)
    } else {
      console.log(`Creating/updating CNAME record for ${targetName} -> ${targetValue}`);
      await recordDelete("A", hostedZoneId, targetName, targetValue)
      await recordCreate("CNAME", hostedZoneId, targetName, targetValue)
    }
  }
}

// Main function to run the script
async function run() {
  const args = process.argv.slice(2);
  // Parse command line arguments
  let hostedZoneName = '';
  let recordNames = [];
  let hostedZoneValue = undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--non-destructive') {
      console.log( "RUNNING IN NON DESTRUCTIVE MODE" );
      nondestructive = true;
    } else if (args[i] === '--zone') {
      hostedZoneName = args[++i];
    } else if (args[i] === '--value') {
      hostedZoneValue = args[++i];
    } else if (args[i] === '--records') {
      recordNames = args.slice(i + 1)
      break;
    }
  }

  // Show help if arguments are missing
  if (!hostedZoneName || recordNames.length === 0) {
    await showHelp();
    process.exit(1);
  }

  console.log('Fetching hosted zones...');
  await listHostedZones();

  console.log(`\nUpdating records in Hosted Zone: ${hostedZoneName}:`);
  await updateHostRecord(hostedZoneName, recordNames, hostedZoneValue);
}

// Run the script
run();
