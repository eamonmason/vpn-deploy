#!/usr/bin/env python3
"""
Migration script to move WireGuard private key from AWS Secrets Manager to SSM Parameter Store.

This script:
1. Retrieves the private key from Secrets Manager
2. Stores it as an encrypted SSM parameter
3. Verifies the migration was successful
4. Optionally deletes the secret from Secrets Manager (after manual confirmation)

Usage:
    python3 migrate-secrets-to-parameters.py --region <region> [--delete-secret]
"""

import argparse
import boto3
import json
import logging
import sys
from typing import Optional

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Configuration
SECRET_NAME = "wireguard/client/publickey"
SSM_PARAMETER_NAME = "/vpn-wireguard/PRIVATE_KEY"


def get_secret_value(secrets_client, secret_name: str) -> Optional[str]:
    """Retrieve the secret value from Secrets Manager."""
    try:
        response = secrets_client.get_secret_value(SecretId=secret_name)
        return response['SecretString']
    except secrets_client.exceptions.ResourceNotFoundException:
        logger.error(f"Secret {secret_name} not found")
        return None
    except Exception as e:
        logger.error(f"Failed to retrieve secret {secret_name}: {e}")
        return None


def put_ssm_parameter(ssm_client, parameter_name: str, value: str) -> bool:
    """Store the value as an encrypted SSM parameter."""
    try:
        ssm_client.put_parameter(
            Name=parameter_name,
            Value=value,
            Type='SecureString',
            Overwrite=True,
            Description='WireGuard client private key (migrated from Secrets Manager)'
        )
        logger.info(f"Successfully stored parameter {parameter_name}")
        return True
    except Exception as e:
        logger.error(f"Failed to store parameter {parameter_name}: {e}")
        return False


def verify_ssm_parameter(ssm_client, parameter_name: str, expected_value: str) -> bool:
    """Verify that the SSM parameter contains the expected value."""
    try:
        response = ssm_client.get_parameter(
            Name=parameter_name,
            WithDecryption=True
        )
        actual_value = response['Parameter']['Value']
        if actual_value == expected_value:
            logger.info(f"Verification successful: parameter {parameter_name} contains correct value")
            return True
        else:
            logger.error(f"Verification failed: parameter {parameter_name} value mismatch")
            return False
    except Exception as e:
        logger.error(f"Failed to verify parameter {parameter_name}: {e}")
        return False


def delete_secret(secrets_client, secret_name: str) -> bool:
    """Delete the secret from Secrets Manager."""
    try:
        # Schedule deletion with a 7-day recovery window
        secrets_client.delete_secret(
            SecretId=secret_name,
            RecoveryWindowInDays=7
        )
        logger.info(f"Successfully scheduled deletion of secret {secret_name} (7-day recovery window)")
        return True
    except Exception as e:
        logger.error(f"Failed to delete secret {secret_name}: {e}")
        return False


def migrate_region(region: str, delete_secret_flag: bool = False) -> bool:
    """Migrate secrets to parameters for a specific region."""
    logger.info(f"Starting migration for region: {region}")
    
    # Initialize clients
    secrets_client = boto3.client('secretsmanager', region_name=region)
    ssm_client = boto3.client('ssm', region_name=region)
    
    # Step 1: Get the secret value
    secret_value = get_secret_value(secrets_client, SECRET_NAME)
    if secret_value is None:
        logger.warning(f"No secret found in region {region}, skipping")
        return False
    
    logger.info(f"Retrieved secret from region {region}")
    
    # Step 2: Store as SSM parameter
    if not put_ssm_parameter(ssm_client, SSM_PARAMETER_NAME, secret_value):
        return False
    
    # Step 3: Verify the migration
    if not verify_ssm_parameter(ssm_client, SSM_PARAMETER_NAME, secret_value):
        return False
    
    # Step 4: Optionally delete the secret
    if delete_secret_flag:
        confirmation = input(f"Are you sure you want to delete the secret in {region}? (yes/no): ")
        if confirmation.lower() == 'yes':
            if delete_secret(secrets_client, SECRET_NAME):
                logger.info(f"Secret deleted from region {region}")
            else:
                logger.error(f"Failed to delete secret from region {region}")
                return False
        else:
            logger.info(f"Skipping secret deletion in region {region}")
    
    logger.info(f"Migration completed successfully for region: {region}")
    return True


def main():
    parser = argparse.ArgumentParser(description='Migrate WireGuard secrets from Secrets Manager to SSM Parameter Store')
    parser.add_argument('--region', required=True, help='AWS region to migrate')
    parser.add_argument('--delete-secret', action='store_true', help='Delete the secret after successful migration')
    parser.add_argument('--all-regions', action='store_true', help='Migrate all VPN regions')
    
    args = parser.parse_args()
    
    # VPN regions as defined in the code
    vpn_regions = ["us-east-1", "eu-west-2", "eu-north-1", "ap-southeast-2"]
    central_region = "eu-west-1"
    
    regions_to_migrate = []
    
    if args.all_regions:
        # Add central region and all VPN regions
        regions_to_migrate = [central_region] + vpn_regions
        # Remove duplicates while preserving order
        seen = set()
        regions_to_migrate = [x for x in regions_to_migrate if not (x in seen or seen.add(x))]
    else:
        regions_to_migrate = [args.region]
    
    logger.info(f"Will migrate regions: {regions_to_migrate}")
    
    success_count = 0
    for region in regions_to_migrate:
        try:
            if migrate_region(region, args.delete_secret):
                success_count += 1
        except Exception as e:
            logger.error(f"Unexpected error migrating region {region}: {e}")
    
    logger.info(f"Migration completed. {success_count}/{len(regions_to_migrate)} regions migrated successfully.")
    
    if success_count == len(regions_to_migrate):
        logger.info("All migrations completed successfully!")
        sys.exit(0)
    else:
        logger.error("Some migrations failed. Please check the logs and retry.")
        sys.exit(1)


if __name__ == "__main__":
    main()