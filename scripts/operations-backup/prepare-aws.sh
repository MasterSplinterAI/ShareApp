#!/usr/bin/env bash
# REVIEW FIRST. This script creates cloud resources only after explicit opt-in.
set -euo pipefail
test "${LALIA_APPROVED_BACKUP_SETUP:-}" = yes || { echo 'Review required: set LALIA_APPROVED_BACKUP_SETUP=yes to execute.' >&2; exit 1; }
cd "$(dirname "$0")"
AWS=(aws --profile jarmetals --region us-east-2)
test "$("${AWS[@]}" sts get-caller-identity --query Account --output text)" = 690248313257
test "$("${AWS[@]}" ec2 describe-instances --instance-ids i-0272367e1422b061d --query 'Reservations[0].Instances[0].IamInstanceProfile.Arn' --output text)" = None
bucket=lalia-backups-690248313257-us-east-2
role=LaliaDailyBackupWriter
"${AWS[@]}" s3api create-bucket --bucket "$bucket" --create-bucket-configuration LocationConstraint=us-east-2
"${AWS[@]}" s3api put-public-access-block --bucket "$bucket" --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
"${AWS[@]}" s3api put-bucket-ownership-controls --bucket "$bucket" --ownership-controls 'Rules=[{ObjectOwnership=BucketOwnerEnforced}]'
"${AWS[@]}" s3api put-bucket-encryption --bucket "$bucket" --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
"${AWS[@]}" s3api put-bucket-versioning --bucket "$bucket" --versioning-configuration Status=Enabled
"${AWS[@]}" s3api put-bucket-policy --bucket "$bucket" --policy file://bucket-policy.json
"${AWS[@]}" s3api put-bucket-lifecycle-configuration --bucket "$bucket" --lifecycle-configuration file://lifecycle.json
"${AWS[@]}" iam create-role --role-name "$role" --assume-role-policy-document file://iam-trust.json
"${AWS[@]}" iam put-role-policy --role-name "$role" --policy-name LaliaDailyBackupPutOnly --policy-document file://iam-put-only.json
"${AWS[@]}" iam create-instance-profile --instance-profile-name "$role"
"${AWS[@]}" iam add-role-to-instance-profile --instance-profile-name "$role" --role-name "$role"
"${AWS[@]}" iam wait instance-profile-exists --instance-profile-name "$role"
# IAM may require propagation time; if association fails retry only this command after inspection.
"${AWS[@]}" ec2 associate-iam-instance-profile --instance-id i-0272367e1422b061d --iam-instance-profile Name="$role"
