#!/usr/bin/env python3
"""
Test script to validate the migration script functionality.
This tests the script logic without making actual AWS calls.
"""

import unittest
from unittest.mock import Mock, patch, call
import sys
import os

# Add the migration directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'migration'))

# Import the migration script functions
import subprocess
import importlib.util

# Load the migration script as a module
spec = importlib.util.spec_from_file_location("migrate", "migration/migrate-secrets-to-parameters.py")
migrate_module = importlib.util.module_from_spec(spec)


class TestMigrationScript(unittest.TestCase):
    
    def test_script_help(self):
        """Test that the migration script shows help correctly."""
        result = subprocess.run([
            'python3', 'migration/migrate-secrets-to-parameters.py', '--help'
        ], capture_output=True, text=True)
        
        self.assertEqual(result.returncode, 0)
        self.assertIn('Migrate WireGuard secrets', result.stdout)
        self.assertIn('--region', result.stdout)
        self.assertIn('--delete-secret', result.stdout)
        self.assertIn('--all-regions', result.stdout)
    
    def test_script_syntax(self):
        """Test that the migration script has valid Python syntax."""
        result = subprocess.run([
            'python3', '-m', 'py_compile', 'migration/migrate-secrets-to-parameters.py'
        ], capture_output=True, text=True)
        
        self.assertEqual(result.returncode, 0, f"Syntax error: {result.stderr}")
    
    def test_script_missing_region(self):
        """Test that the script fails when region is not provided."""
        result = subprocess.run([
            'python3', 'migration/migrate-secrets-to-parameters.py'
        ], capture_output=True, text=True)
        
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('required', result.stderr.lower())
    
    def test_migration_constants(self):
        """Test that the migration script has the correct constants."""
        with open('migration/migrate-secrets-to-parameters.py', 'r') as f:
            content = f.read()
        
        # Check for required constants
        self.assertIn('SECRET_NAME = "wireguard/client/publickey"', content)
        self.assertIn('SSM_PARAMETER_NAME = "/vpn-wireguard/PRIVATE_KEY"', content)
        
        # Check for proper VPN regions
        self.assertIn('us-east-1', content)
        self.assertIn('eu-west-2', content)
        self.assertIn('eu-north-1', content)
        self.assertIn('ap-southeast-2', content)
        self.assertIn('eu-west-1', content)  # Central region


if __name__ == '__main__':
    unittest.main()