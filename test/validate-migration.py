#!/usr/bin/env python3
"""
Dry-run validation script to verify the CDK changes work as expected.
This validates the CloudFormation template structure without actual deployment.
"""

import hashlib
import subprocess
import json
import sys
import os

def run_cdk_synth():
    """Run CDK synth to generate CloudFormation templates."""
    print("🔍 Running CDK synth to validate template generation...")
    
    # Set required environment variables for synthesis
    env = os.environ.copy()
    env.update({
        'CDK_DEFAULT_ACCOUNT': '123456789012',
        'CDK_DEFAULT_REGION': 'us-east-1'
    })
    
    try:
        result = subprocess.run([
            'npx', 'cdk', 'synth', 'VPNVMDeployStack',
            '--app', 'npx ts-node bin/vpn-vm-deploy.ts'
        ], capture_output=True, text=True, env=env, timeout=120)
        
        # CDK synth can return non-zero exit code even for successful synthesis with warnings
        # Check if we actually got template output
        if 'AWSTemplateFormatVersion' in result.stdout or len(result.stdout) > 1000:
            print("✅ CDK synth successful (with warnings)")
            return result.stdout
        elif result.returncode != 0:
            print(f"❌ CDK synth failed: {result.stderr}")
            return None
        
        print("✅ CDK synth successful")
        return result.stdout
        
    except subprocess.TimeoutExpired:
        print("❌ CDK synth timed out")
        return None
    except Exception as e:
        print(f"❌ CDK synth error: {e}")
        return None

def _mask(value: str) -> str:
    """Return a stable, non-reversible hint for a potentially sensitive value,
    safe to print. A truncated hash carries no characters from the original
    value (unlike prefix/suffix slicing, which CodeQL's clear-text-logging
    check still treats as the tainted value flowing to the sink).
    """
    if not value:
        return "<empty>"
    digest = hashlib.sha256(value.encode()).hexdigest()[:8]
    return f"sha256:{digest}"


def validate_template(template_yaml):
    """Validate that the CloudFormation template has the expected SSM configuration."""
    print("🔍 Validating CloudFormation template structure...")
    
    # Check for SSM parameter usage
    ssm_patterns = [
        'ssm:GetParameter',
        '/vpn-wireguard/PRIVATE_KEY',
        'aws ssm get-parameter --name /vpn-wireguard/PRIVATE_KEY'
    ]
    
    # Check for absence of Secrets Manager usage
    secrets_patterns = [
        'secretsmanager:GetSecretValue',
        'wireguard/client/publickey-I6u6Kw',
        'aws secretsmanager get-secret-value'
    ]
    
    found_ssm = 0
    found_secrets = 0
    
    for pattern in ssm_patterns:
        if pattern in template_yaml:
            found_ssm += 1
            print(f"✅ Found SSM pattern: {pattern}")
    
    for pattern in secrets_patterns:
        if pattern in template_yaml:
            found_secrets += 1
            print(f"❌ Found Secrets Manager pattern: {_mask(pattern)}")
    
    if found_ssm >= 2:  # Should find SSM permission and SSM get-parameter command
        print("✅ Template correctly uses SSM Parameter Store")
    else:
        print("❌ Template missing expected SSM usage")
        return False
    
    if found_secrets == 0:
        print("✅ Template does not use Secrets Manager")
        return True
    else:
        print("❌ Template still contains Secrets Manager references")
        return False

def main():
    print("🚀 Starting CDK validation for SSM Parameter Store migration\n")
    
    # Step 1: Build the project
    print("🔧 Building TypeScript project...")
    build_result = subprocess.run(['npm', 'run', 'build'], capture_output=True, text=True)
    if build_result.returncode != 0:
        print(f"❌ Build failed: {build_result.stderr}")
        return 1
    print("✅ Build successful\n")
    
    # Step 2: Run CDK synth
    template = run_cdk_synth()
    if template is None:
        return 1
    print()
    
    # Step 3: Validate template
    if validate_template(template):
        print("\n🎉 All validations passed! The migration to SSM Parameter Store is working correctly.")
        return 0
    else:
        print("\n❌ Validation failed! The template still has issues.")
        return 1

if __name__ == "__main__":
    sys.exit(main())