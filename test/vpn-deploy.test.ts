import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { VPNVMDeployStack } from '../lib/vpn-vm-deploy-stack';

// Test for SSM parameter usage instead of Secrets Manager
test('VPN Stack uses SSM Parameter Store instead of Secrets Manager', () => {
  const app = new cdk.App();
  
  // Set required environment variables for the test
  process.env.CDK_DEFAULT_ACCOUNT = '123456789012';
  process.env.CDK_DEFAULT_REGION = 'us-east-1';
  
  // WHEN
  const stack = new VPNVMDeployStack(app, 'MyTestStack');
  
  // THEN
  const template = Template.fromStack(stack);

  // Verify that the IAM role has SSM permissions instead of Secrets Manager
  template.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: [
        {
          Action: 'ssm:GetParameter',
          Effect: 'Allow',
          Resource: 'arn:aws:ssm:eu-west-1:123456789012:parameter/vpn-wireguard/PRIVATE_KEY'
        }
      ]
    }
  });

  // Verify that there are no Secrets Manager permissions
  template.resourceCountIs('AWS::IAM::Policy', 1);
  const policies = template.findResources('AWS::IAM::Policy');
  
  for (const policyKey in policies) {
    const policy = policies[policyKey];
    const statements = policy.Properties.PolicyDocument.Statement;
    
    // Ensure no secretsmanager actions exist
    for (const statement of statements) {
      if (Array.isArray(statement.Action)) {
        expect(statement.Action).not.toContain('secretsmanager:GetSecretValue');
      } else if (typeof statement.Action === 'string') {
        expect(statement.Action).not.toBe('secretsmanager:GetSecretValue');
      }
    }
  }
});

// Original test kept for backwards compatibility
test('SQS Queue Created', () => {
//   const app = new cdk.App();
//     // WHEN
//   const stack = new VpnDeploy.VpnDeployStack(app, 'MyTestStack');
//     // THEN
//   const template = Template.fromStack(stack);

//   template.hasResourceProperties('AWS::SQS::Queue', {
//     VisibilityTimeout: 300
//   });
});
