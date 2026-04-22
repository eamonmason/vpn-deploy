# Migration from AWS Secrets Manager to SSM Parameter Store

This directory contains the migration script to convert WireGuard private keys from AWS Secrets Manager to SSM Parameter Store for cost savings.

## Prerequisites

- Python 3.6+
- boto3 library (`pip install boto3`)
- AWS credentials configured with appropriate permissions:
  - `secretsmanager:GetSecretValue` for reading existing secrets
  - `ssm:PutParameter` and `ssm:GetParameter` for SSM Parameter Store
  - `secretsmanager:DeleteSecret` if using the `--delete-secret` option

## Usage

### Migrate a single region

```bash
python3 migrate-secrets-to-parameters.py --region eu-west-1
```

### Migrate all VPN regions

```bash
python3 migrate-secrets-to-parameters.py --region eu-west-1 --all-regions
```

### Migrate and delete the original secret (after verification)

```bash
python3 migrate-secrets-to-parameters.py --region eu-west-1 --delete-secret
```

## What the script does

1. **Retrieves** the private key from Secrets Manager (`wireguard/client/publickey`)
2. **Stores** it as an encrypted SSM parameter (`/vpn-wireguard/PRIVATE_KEY`)
3. **Verifies** the migration was successful by reading back the parameter
4. **Optionally deletes** the secret from Secrets Manager (with 7-day recovery window)

## Safety Features

- The script verifies successful migration before proceeding
- Secret deletion requires manual confirmation
- Deleted secrets have a 7-day recovery window
- Comprehensive logging for troubleshooting

## Regions

The VPN deployment uses these regions:
- **Central region**: eu-west-1 (where the secret is stored)
- **VPN regions**: us-east-1, eu-west-2, eu-north-1, ap-southeast-2

## Cost Savings

Moving from AWS Secrets Manager to SSM Parameter Store reduces costs:
- **Secrets Manager**: ~$0.40/month per secret
- **SSM Parameter Store**: Free for Standard parameters, ~$0.05/month for advanced parameters

For a single secret across multiple regions, this can save ~$1.50-2.00/month.