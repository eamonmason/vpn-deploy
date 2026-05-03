"""Secrets Manager rotation Lambda for the VPN Starter Proxy API key.

Implements the four-step rotation lifecycle required by AWS Secrets Manager:
  1. createSecret  - generate the candidate secret and store it as AWSPENDING
  2. setSecret     - apply the new secret to the protected resource (no-op here)
  3. testSecret    - verify the AWSPENDING secret is valid
  4. finishSecret  - promote AWSPENDING to AWSCURRENT
"""

import json
import logging
import secrets
import string

import boto3

logger = logging.getLogger()
logger.setLevel(logging.INFO)

client = boto3.client("secretsmanager")


def handler(event, context):
    secret_id = event["SecretId"]
    token = event["ClientRequestToken"]
    step = event["Step"]

    metadata = client.describe_secret(SecretId=secret_id)
    versions = metadata.get("VersionIdsToStages", {})

    if token not in versions:
        raise ValueError(f"Token {token} not found in secret versions")
    if "AWSCURRENT" in versions[token]:
        logger.info("Token is already AWSCURRENT — nothing to do.")
        return
    if "AWSPENDING" not in versions[token] and step != "createSecret":
        raise ValueError(f"Token {token} is not AWSPENDING")

    if step == "createSecret":
        _create_secret(secret_id, token)
    elif step == "setSecret":
        pass  # No external system to update; the Lambda reads from Secrets Manager at runtime.
    elif step == "testSecret":
        _test_secret(secret_id, token)
    elif step == "finishSecret":
        _finish_secret(secret_id, token)
    else:
        raise ValueError(f"Unknown step: {step}")


def _create_secret(secret_id: str, token: str):
    try:
        client.get_secret_value(SecretId=secret_id, VersionStage="AWSPENDING")
        logger.info("AWSPENDING already exists — skipping creation.")
        return
    except client.exceptions.ResourceNotFoundException:
        pass

    alphabet = string.ascii_letters + string.digits
    new_key = "".join(secrets.choice(alphabet) for _ in range(32))

    current = json.loads(
        client.get_secret_value(SecretId=secret_id, VersionStage="AWSCURRENT")["SecretString"]
    )
    current["apiKey"] = new_key

    client.put_secret_value(
        SecretId=secret_id,
        ClientRequestToken=token,
        SecretString=json.dumps(current),
        VersionStages=["AWSPENDING"],
    )
    logger.info("Created AWSPENDING secret with new API key.")


def _test_secret(secret_id: str, token: str):
    pending = json.loads(
        client.get_secret_value(SecretId=secret_id, VersionStage="AWSPENDING")["SecretString"]
    )
    api_key = pending.get("apiKey", "")
    if len(api_key) < 16 or not api_key.isalnum():
        raise ValueError(f"AWSPENDING apiKey failed validation: {api_key!r}")
    logger.info("AWSPENDING secret passed validation.")


def _finish_secret(secret_id: str, token: str):
    metadata = client.describe_secret(SecretId=secret_id)
    current_version = next(
        v for v, stages in metadata["VersionIdsToStages"].items() if "AWSCURRENT" in stages
    )
    if current_version == token:
        logger.info("Token is already AWSCURRENT.")
        return

    client.update_secret_version_stage(
        SecretId=secret_id,
        VersionStage="AWSCURRENT",
        MoveToVersionId=token,
        RemoveFromVersionId=current_version,
    )
    logger.info("Promoted AWSPENDING to AWSCURRENT.")
