#!/usr/bin/env node

const AWS = require('aws-sdk');
const process = require('process');

const route53 = new AWS.Route53();

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
  node update-cname.js --zone "example.com." --records "www" "api" "private"
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

async function wouldChangeRecord(hostedZoneId, recordName, targetValue) {
  try {
    const result = await route53.listResourceRecordSets({
      HostedZoneId: hostedZoneId,
      StartRecordName: recordName,
      StartRecordType: 'CNAME',
      MaxItems: '1'
    }).promise();

    const existing = result.ResourceRecordSets[0];
    if (
      existing &&
      existing.Name === (recordName.endsWith('.') ? recordName : recordName + '.') &&
      existing.Type === 'CNAME'
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

// Function to create or update CNAME records
async function updateCNAMERecord(hostedZoneName, recordNames, nondestructive=true) {
  const hostedZoneId = await getHostedZoneIdByName(hostedZoneName);

  for (const recordName of recordNames) {
    const targetValue = `${hostedZoneName.replace(/\.$/,'')}`;
    const targetName = `${recordName}.${hostedZoneName.replace(/\.$/,'')}`;
    const params = {
      HostedZoneId: hostedZoneId,
      ChangeBatch: {
        Comment: `Add or update CNAME record for ${recordName}`,
        Changes: [
          {
            Action: 'UPSERT', // 'UPSERT' will create or update the record if it already exists
            ResourceRecordSet: {
              Name: targetName,
              Type: 'CNAME',
              TTL: 300,
              ResourceRecords: [{ Value: targetValue }]
            }
          }
        ]
      }
    };
    //console.log( `[${recordName}] hostedZoneId:${hostedZoneId} hostedZoneName:${hostedZoneName} targetName:${targetName} targetValue:${targetValue}` )
    //continue

    try {
      const result = nondestructive ? await wouldChangeRecord(hostedZoneId, recordName, targetName).willChange : await route53.changeResourceRecordSets(params).promise();
      console.log(`✅ CNAME record created or updated: ${recordName}.${hostedZoneName} -> ${targetValue}`);
    } catch (err) {
      console.error('❌ Error creating/updating CNAME record:', err.message);
    }
  }
}

// Main function to run the script
async function run() {
  const args = process.argv.slice(2);
  // Parse command line arguments
  let hostedZoneName = '';
  let recordNames = [];
  let nondestructive = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--non-destructive') {
      nondestructive = true;
    } else if (args[i] === '--zone') {
      hostedZoneName = args[++i];
    } else if (args[i] === '--records') {
      recordNames = args.slice(i + 1)
      break;
    }
  }
  //console.log( hostedZoneName, recordNames, nondestructive )

  // Show help if arguments are missing
  if (!hostedZoneName || recordNames.length === 0) {
    await showHelp();
    process.exit(1);
  }

  console.log('Fetching hosted zones...');
  await listHostedZones();

  console.log(`\nAdding/updating CNAME records in Hosted Zone: ${hostedZoneName}`);
  await updateCNAMERecord(hostedZoneName, recordNames, nondestructive);
}

// Run the script
run();
