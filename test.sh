ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=eu-west-1
REPO=eamonmason/vpn-deploy

# 1. Create the GitHub OIDC provider (skip with `|| true` if it already exists)
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 || true

# 2. Trust policy: only this repo can assume the role
cat > /tmp/trust.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::${ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      "StringLike":   { "token.actions.githubusercontent.com:sub": "repo:${REPO}:*" }
    }
  }]
}
EOF

# 3. Permissions: just trigger rotation on the one secret
cat > /tmp/perms.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": "secretsmanager:RotateSecret",
    "Resource": "arn:aws:secretsmanager:${REGION}:${ACCOUNT_ID}:secret:vpn-starter-proxy-api-key-*"
  }]
}
EOF

# 4. Create the role and attach the policy
aws iam create-role \
  --role-name vpn-deploy-secret-rotation \
  --assume-role-policy-document file:///tmp/trust.json

aws iam put-role-policy \
  --role-name vpn-deploy-secret-rotation \
  --policy-name secretsmanager-rotate \
  --policy-document file:///tmp/perms.json

# 5. Set the GitHub Secret
ROLE_ARN="arn:aws:iam::${ACCOUNT_ID}:role/vpn-deploy-secret-rotation"
gh secret set AWS_DEPLOY_ROLE_ARN --body "$ROLE_ARN" -R "$REPO"

echo "Done. Role ARN: $ROLE_ARN"
