#!/bin/bash

# Variables
USER_NAME="StaticSiteHostingUser"  # Change this to your desired IAM user name
POLICY_NAME="CloudFrontAccessPolicy" # Name of the policy to be created

# Function to get IAM user ID
get_user_id() {
  aws iam get-user --user-name "$USER_NAME" --query 'User.UserId' --output text
}
get_user_id_verbose() {
  aws iam get-user --user-name "$USER_NAME"
}

# check if the policy already exists
policy_exists() {
  aws iam list-policies --query "Policies[?PolicyName=='$POLICY_NAME'].{Name:PolicyName}" --output text | grep -q "$POLICY_NAME"
}

# Function to count existing access keys
count_access_keys() {
  aws iam list-access-keys --user-name "$USER_NAME" --query 'AccessKeyMetadata[*].AccessKeyId' --output text | wc -w
}

# Check if the script is run with --force
FORCE=false
if [[ "$1" == "--force" ]]; then
  FORCE=true
fi

# Check if IAM User already exists
if aws iam get-user --user-name "$USER_NAME" > /dev/null 2>&1; then
  if [ "$FORCE" = false ]; then
    echo "IAM user '$USER_NAME' already exists."
    get_user_id_verbose
    USER_ID=$(get_user_id)
    echo "User ID: $USER_ID"
    echo "Exiting script. Use --force to create the user again (and get your ONE TIME security keys)."
    exit 1
  fi
else
  # Create IAM User
  echo "Creating IAM user: $USER_NAME"
  aws iam create-user --user-name "$USER_NAME"
fi

# Check for existing access keys
KEY_COUNT=$(count_access_keys)

# If the user has 2 access keys, delete the oldest one (or you can choose to delete any)
if [ "$KEY_COUNT" -ge 2 ]; then
  echo "User already has $KEY_COUNT access keys. Deleting the oldest access key."
  OLD_KEY_ID=$(aws iam list-access-keys --user-name "$USER_NAME" --query 'AccessKeyMetadata[0].AccessKeyId' --output text)
  aws iam delete-access-key --user-name "$USER_NAME" --access-key-id "$OLD_KEY_ID"
fi

# Check if the IAM policy already exists
if policy_exists; then
  echo "IAM policy '$POLICY_NAME' already exists."
else
  # Create IAM Policy
  echo "Creating IAM policy: $POLICY_NAME"
  POLICY_ARN=$(aws iam create-policy --policy-name "$POLICY_NAME" --policy-document '{
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": [
          "cloudfront:CreateDistribution",
          "cloudfront:UpdateDistribution",
          "cloudfront:DeleteDistribution",
          "cloudfront:GetDistribution",
          "cloudfront:TagResource",
          "cloudfront:CreateOriginAccessControl",
          "cloudfront:UpdateOriginAccessControl",
          "cloudfront:DeleteOriginAccessControl",
          "cloudfront:ListOriginAccessControls",
          "cloudfront:GetOriginAccessControl",
          "cloudfront:GetOriginAccessControlConfig"
        ],
        "Resource": "*"
      }
    ]
  }' --query 'Policy.Arn' --output text)
fi

# Attach Policy to User
if [ -n "$POLICY_ARN" ]; then
  echo "Attaching policy to user"
  aws iam attach-user-policy --user-name "$USER_NAME" --policy-arn "$POLICY_ARN"
else
  # If the policy exists, find its ARN and attach it
  POLICY_ARN=$(aws iam list-policies --query "Policies[?PolicyName=='$POLICY_NAME'].{Arn:Arn}" --output text)
  echo "Attaching existing policy to user"
  aws iam attach-user-policy --user-name "$USER_NAME" --policy-arn "$POLICY_ARN"
fi

# Output User and Policy Information
echo "IAM user '$USER_NAME' created and policy '$POLICY_NAME' attached."
USER_ID=$(get_user_id)
echo "User ID: $USER_ID"

# Create Access Key
echo "Creating access key for user. IMPORTANT: Record the Secret Access Key shown below!"
ACCESS_KEY_JSON=$(aws iam create-access-key --user-name "$USER_NAME")
echo "$ACCESS_KEY_JSON" | jq '.AccessKey | {AccessKeyId, SecretAccessKey}'

# Reminder to record the secret key
echo "This is your ONE TIME opportunity to record the Secret Access Key. Make sure to save it securely!"
