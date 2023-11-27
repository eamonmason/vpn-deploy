import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as route53 from 'aws-cdk-lib/aws-route53';

export class VPNVMDeployStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const PRIVATE_IP_CIDR = process.env.PRIVATE_IP_CIDR || '';    
    const WIREGUARD_IMAGE = process.env.WIREGUARD_IMAGE || '';
    const PUBLIC_KEY = process.env.PUBLIC_KEY || '';

    if (PRIVATE_IP_CIDR == '' || WIREGUARD_IMAGE == '') {
      throw new Error("PRIVATE_IP_CIDR or WIREGUARD_IMAGE environment variable(s) not set")
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
          cidrMask: 24,
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

    // Find the Wireguard AMI I created in various regions    
    const wireguard_ami = new ec2.LookupMachineImage({
      name: WIREGUARD_IMAGE,  
      owners: [process.env.CDK_DEFAULT_ACCOUNT || process.env.account || '002681522526'],  
      windows: false,
    });

    const vpnASG = new autoscaling.AutoScalingGroup(this, 'VPNASG', {
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      machineImage: wireguard_ami,
      associatePublicIpAddress: true,
      vpcSubnets: { subnetGroupName: 'public' },
      keyName: vpnVMKeyPair.keyName,    
      minCapacity: 0,
      maxCapacity: 1,
      securityGroup: vpnSecurityGroup,
    });
  }
}
