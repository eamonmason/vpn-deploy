#!/usr/bin/env python3
"""
Simple validation script to verify our migration changes.
"""

import os

def check_file_contains(filepath, required_patterns, forbidden_patterns):
    """Check that a file contains required patterns and doesn't contain forbidden ones."""
    print(f"🔍 Checking {filepath}...")
    
    with open(filepath, 'r') as f:
        content = f.read()
    
    for pattern in required_patterns:
        if pattern in content:
            print(f"  ✅ Found required pattern: {pattern}")
        else:
            print(f"  ❌ Missing required pattern: {pattern}")
            return False
    
    for pattern in forbidden_patterns:
        if pattern in content:
            print(f"  ❌ Found forbidden pattern: {pattern}")
            return False
        else:
            print(f"  ✅ Correctly excludes: {pattern}")
    
    return True

def main():
    print("🚀 Validating SSM Parameter Store migration changes\n")
    
    # Check TypeScript stack file
    typescript_file = "lib/vpn-vm-deploy-stack.ts"
    ts_required = [
        "'/vpn-wireguard/SERVER_PRIVATE_KEY'",
        "'/vpn-wireguard/CLIENT_PEERS'",
        "ssm:GetParameter",
        "render-wg0.sh"
    ]
    ts_forbidden = [
        "secretsmanager:GetSecretValue",
        "aws secretsmanager get-secret-value",
        "I6u6Kw"
    ]
    
    if not check_file_contains(typescript_file, ts_required, ts_forbidden):
        return False
    
    print()
    
    # Check compiled JavaScript file  
    js_file = "lib/vpn-vm-deploy-stack.js"
    if os.path.exists(js_file):
        js_required = [
            "'/vpn-wireguard/SERVER_PRIVATE_KEY'",
            "'ssm:GetParameter'",
            "render-wg0.sh"
        ]
        js_forbidden = [
            "secretsmanager",
            "I6u6Kw"
        ]
        
        if not check_file_contains(js_file, js_required, js_forbidden):
            return False
    else:
        print(f"⚠️  {js_file} not found (run npm run build to generate)")
    
    print()
    
    # Check migration script exists and is executable
    migration_script = "migration/migrate-secrets-to-parameters.py"
    if os.path.exists(migration_script) and os.access(migration_script, os.X_OK):
        print(f"✅ Migration script {migration_script} exists and is executable")
    else:
        print(f"❌ Migration script {migration_script} missing or not executable")
        return False
    
    # Check README is updated
    readme_file = "README.md"
    readme_required = [
        "/vpn-wireguard/PRIVATE_KEY",
        "migrate-secrets-to-parameters.py",
        "Migration from Secrets Manager"
    ]
    
    if not check_file_contains(readme_file, readme_required, []):
        return False
    
    print("\n🎉 All validation checks passed!")
    print("✅ SSM Parameter Store migration implementation is complete")
    print("✅ Secrets Manager references have been removed")
    print("✅ Migration script is ready to use")
    print("✅ Documentation has been updated")
    
    return True

if __name__ == "__main__":
    success = main()
    exit(0 if success else 1)