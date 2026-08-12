import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { VPNVMDeployStack } from '../lib/vpn-vm-deploy-stack';

// Test for SSM parameter usage instead of Secrets Manager
test('VPN Stack uses SSM Parameter Store instead of Secrets Manager', () => {
  const app = new cdk.App({
    context: {
      "@aws-cdk/aws-autoscaling:generateLaunchTemplateInsteadOfLaunchConfig": true
    }
  });
  
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
          Resource: [
            'arn:aws:ssm:eu-west-1:123456789012:parameter/vpn-wireguard/SERVER_PRIVATE_KEY',
            'arn:aws:ssm:eu-west-1:123456789012:parameter/vpn-wireguard/CLIENT_PEERS',
            'arn:aws:ssm:eu-west-1:123456789012:parameter/vpn-wireguard/MTU'
          ]
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

// Port 51413 must be open so the AMI's DNAT rule (see the vpn-image repo's
// wg0.conf.template) can actually forward inbound torrent-peer traffic to the client.
test('VPN Stack opens TCP and UDP 51413 for the DNAT-forwarded torrent peer', () => {
  const app = new cdk.App({
    context: {
      "@aws-cdk/aws-autoscaling:generateLaunchTemplateInsteadOfLaunchConfig": true
    }
  });

  process.env.CDK_DEFAULT_ACCOUNT = '123456789012';
  process.env.CDK_DEFAULT_REGION = 'us-east-1';

  const stack = new VPNVMDeployStack(app, 'MyTestStack');
  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::EC2::SecurityGroup', Match.objectLike({
    SecurityGroupIngress: Match.arrayWith([
      Match.objectLike({ IpProtocol: 'tcp', FromPort: 51413, ToPort: 51413, CidrIp: '0.0.0.0/0' }),
      Match.objectLike({ IpProtocol: 'udp', FromPort: 51413, ToPort: 51413, CidrIp: '0.0.0.0/0' }),
    ]),
  }));
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
