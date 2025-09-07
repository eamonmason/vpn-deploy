import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as iam from 'aws-cdk-lib/aws-iam';

export class VPNVMDeployStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const PRIVATE_IP_CIDR = ssm.StringParameter.valueForStringParameter(this, '/vpn-wireguard/PRIVATE_IP_CIDR');
    const PUBLIC_KEY = ssm.StringParameter.valueForStringParameter(this, '/vpn-wireguard/PUBLIC_KEY');

    if (PRIVATE_IP_CIDR == '' || PUBLIC_KEY == '') {
      throw new Error("Required environment variables not set")
    }

    // Handle VPC creation with an escape hatch to prevent recreation
    // Use a custom resource to indicate if we should create the VPC or not
    let vpc: ec2.IVpc;
    
    // Create VPC with a custom escape hatch to prevent recreation
    // Create a new logical ID that's stable across deployments
    const vpcLogicalId = 'VPNVPC';
    vpc = new ec2.Vpc(this, vpcLogicalId, {
      maxAzs: 1,
      ipAddresses: ec2.IpAddresses.cidr('172.32.0.0/16'),
      subnetConfiguration: [
        {
          subnetType: ec2.SubnetType.PUBLIC,
          name: 'public',
          cidrMask: 28,
        },
        {
          cidrMask: 28,
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          reserved: true
        }
      ]
    });
    
    // Apply an escape hatch to prevent the VPC from being replaced during updates
    // This marks the VPC as non-replaceable, so CDK will keep the same VPC across deployments
    const cfnVpc = vpc.node.defaultChild as ec2.CfnVPC;
    cfnVpc.cfnOptions.deletionPolicy = cdk.CfnDeletionPolicy.RETAIN;
    cfnVpc.cfnOptions.updateReplacePolicy = cdk.CfnDeletionPolicy.RETAIN;

    // Minimal security group for the VM only allowing access from my own IP
    const vpnSecurityGroup = new ec2.SecurityGroup(this, 'VPNSecurityGroup', {
      vpc,
      description: 'Allow SSH (TCP 22) and VPN for WireGuard (UDP 51820)',
      allowAllOutbound: true   // Can be set to false
    });

    vpnSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(PRIVATE_IP_CIDR),
      ec2.Port.tcp(22),
      'allow ssh access from my IP address');

    vpnSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(PRIVATE_IP_CIDR),
      ec2.Port.udp(51820),
      'allow vpn access from my IP address');

    const stack = cdk.Stack.of(this);
    const stack_id = stack.stackId.substring(stack.stackId.lastIndexOf('/') + 1);
    const vpnVMKeyPair = new ec2.CfnKeyPair(this, 'VPNVMKeyPair', {
      keyName: `vpnvm-keypair-${ stack_id }`,
      publicKeyMaterial: PUBLIC_KEY,
    });

    const accountId = process.env.CDK_DEFAULT_ACCOUNT || process.env.accountId || '';
    const central_region = 'eu-west-1';
    // Find the Wireguard AMI I created in various regions    
    const wireguard_ami = ec2.MachineImage.fromSsmParameter('/vpn-wireguard/WIREGUARD_IMAGE')

    // Use SSM Parameter Store instead of Secrets Manager for the private key
    const privateKeyParameterName = '/vpn-wireguard/PRIVATE_KEY';

    const vpnInstanceRole = new iam.Role(this, 'VPNInstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
    });

    vpnInstanceRole.addToPolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [`arn:aws:ssm:${central_region}:${accountId}:parameter${privateKeyParameterName}`],
    }));

    const vpnInstanceProfile = new iam.CfnInstanceProfile(this, 'VPNInstanceProfile', {
      roles: [vpnInstanceRole.roleName],
    });

    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      '# UserData version 1.0.3', // Increment version to force changes
      'sudo yum install -y aws-cli',
      `PRIVATE_KEY_VALUE=$(aws ssm get-parameter --name ${privateKeyParameterName} --with-decryption --region ${central_region} --query Parameter.Value --output text)`,
      'sudo wg-quick down wg0 || true', // Add || true to prevent failure if wg0 isn't up
      'echo "$PRIVATE_KEY_VALUE" | sudo tee -a /etc/wireguard/wg0.conf',
      'sudo wg-quick up wg0'
    );

    const vpnASG = new autoscaling.AutoScalingGroup(this, 'VPNASG', {
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      machineImage: wireguard_ami,
      associatePublicIpAddress: true,
      keyName: vpnVMKeyPair.keyName, // Use keyName for compatibility (deprecated but works)
      minCapacity: 0,
      maxCapacity: 1,
      securityGroup: vpnSecurityGroup,
      userData: userData,
      role: vpnInstanceRole,
    });
  }
}
