#!/bin/bash
if [ ! -f "parameters.sourceme.sh" ]; then
  echo "error:  parameters.sourceme.sh doesn't exist"
  exit -1
fi
source parameters.sourceme.sh

#aws cloudfront list-distributions

echo "Bucket name is: $BUCKET_NAME"
aws cloudfront list-distributions --query "DistributionList.Items[*].{ID:Id,Domain:DomainName,Origin:Origins.Items[0].DomainName,Comment:Comment}" --output table

DIST_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Origins.Items[?DomainName=='${BUCKET_NAME}.s3.us-west-2.amazonaws.com']].Id | [0]" \
  --output text)

echo "Cloudfront DIST_ID is: $DIST_ID"
aws cloudfront create-invalidation  --distribution-id "$DIST_ID" --paths "/*"

