source parameters.sourceme.sh

#aws cloudformation validate-template --template-body file://infra.yaml

aws cloudformation deploy --stack-name "$BUCKET_NAME" --template-file infra.yaml \
  --parameter-overrides "S3BucketName=$BUCKET_NAME" \
    "DomainName=$DomainName" \
    "DomainName2=$DomainName2" \
    "EditableHostname=$EditableHostname" \
    "StaticHostnameForTesting=$StaticHostnameForTesting" \
  --capabilities CAPABILITY_IAM CAPABILITY_NAMED_IAM

