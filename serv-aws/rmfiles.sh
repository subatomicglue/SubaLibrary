source parameters.sourceme.sh

# clean out the bucket, shiney and new
aws s3 rm "s3://$BUCKET_NAME" --recursive

