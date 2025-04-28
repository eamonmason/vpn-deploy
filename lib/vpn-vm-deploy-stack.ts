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

    // Create a VPC for our VM to use, with ability to change in future
    const vpc = new ec2.Vpc(this, 'VPNVPC', {
      maxAzs: 1,
      ipAddresses: ec2.IpAddresses.cidr('172.31.0.0/16'),
      subnetConfiguration: [
        {
          // 'subnetType' controls Internet access, as described above.
          subnetType: ec2.SubnetType.PUBLIC,
          name: 'public',
          cidrMask: 28,
        },
        {
          cidrMask: 28,
          name: 'private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
    
          // 'reserved' can be used to reserve IP address space. No resources will
          // be created for this subnet, but the IP range will be kept available for
          // future creation of this subnet, or even for future subdivision.
          reserved: true
        }
      ]
    });

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

    const secretArn = `arn:aws:secretsmanager:${central_region}:${accountId}:secret:wireguard/client/publickey-I6u6Kw`;

    const vpnInstanceRole = new iam.Role(this, 'VPNInstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
    });

    vpnInstanceRole.addToPolicy(new iam.PolicyStatement({
      actions: ['secretsmanager:GetSecretValue'],
      resources: [secretArn],
    }));

    const vpnInstanceProfile = new iam.CfnInstanceProfile(this, 'VPNInstanceProfile', {
      roles: [vpnInstanceRole.roleName],
    });

    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      '# UserData version 1.0.2', // Increment version to force changes
      'sudo yum install -y aws-cli',
      `SECRET_VALUE=$(aws secretsmanager get-secret-value --secret-id arn:aws:secretsmanager:${central_region}:${accountId}:secret:wireguard/client/publickey-I6u6Kw --region ${central_region} --query SecretString --output text)`,
      'sudo wg-quick down wg0 || true', // Add || true to prevent failure if wg0 isn't up
      'echo "$SECRET_VALUE" | sudo tee -a /etc/wireguard/wg0.conf',
      'sudo wg-quick up wg0'
    );

    const vpnASG = new autoscaling.AutoScalingGroup(this, 'VPNASG', {
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      machineImage: wireguard_ami,
      associatePublicIpAddress: true,
      keyPair: ec2.KeyPair.fromKeyPairName(this, 'ImportedVPNVMKeyPair', vpnVMKeyPair.keyName), // Updated to use IKeyPair
      minCapacity: 0,
      maxCapacity: 1,
      securityGroup: vpnSecurityGroup,
      userData: userData,
      role: vpnInstanceRole,
    });
  }
}
