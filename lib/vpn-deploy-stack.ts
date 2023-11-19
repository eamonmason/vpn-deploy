import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
// import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as route53 from 'aws-cdk-lib/aws-route53';

export class VpnDeployStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const PRIVATE_IP_CIDR = process.env.PRIVATE_IP_CIDR || '';
    const RECORD_NAME = process.env.RECORD_NAME || 'vpn';
    const ZONE_NAME = process.env.ZONE_NAME || '';
    const WIREGUARD_IMAGE = process.env.WIREGUARD_IMAGE || '';
    const PUBLIC_KEY = process.env.PUBLIC_KEY || '';

    if (PRIVATE_IP_CIDR == '' || ZONE_NAME == '' || WIREGUARD_IMAGE == '') {
      throw new Error("PRIVATE_IP_CIDR, ZONE_NAME or WIREGUARD_IMAGE environment variable(s) not set")
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
    
    // Might be useful for troubleshooting but not necessary
    // vpc.addFlowLog('VPNFlowLog');

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

    const vpnVMKeyPair = new ec2.CfnKeyPair(this, 'VPNVMKeyPair', {
      keyName: 'vpn-key-pair',          
      publicKeyMaterial: PUBLIC_KEY,
    });
    // Find the Wireguard AMI I created in various regions    
    const wireguard_ami = new ec2.LookupMachineImage({
      name: WIREGUARD_IMAGE,  
      owners: [process.env.CDK_DEFAULT_ACCOUNT || ''],  
      windows: false,
    });

    const vpnVM = new ec2.Instance(this, 'VPNVM', {
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      machineImage: wireguard_ami,
      propagateTagsToVolumeOnCreation: true,
      securityGroup: vpnSecurityGroup,
      // Not necessary for public subnet, but hey...
      associatePublicIpAddress: true,
      vpcSubnets: { subnetGroupName: 'public' },
      keyName: vpnVMKeyPair.keyName      
    });

    new cdk.CfnOutput(this, 'InstanceDNS', {
      value: vpnVM.instancePublicDnsName
    });

    const zoneFromAttributes = route53.PublicHostedZone.fromLookup(this, 'HomeZone', {
      domainName: ZONE_NAME,      
    });

    new route53.CnameRecord(this, 'VPNCNameRecord', {
      zone: zoneFromAttributes,
      recordName: RECORD_NAME,
      domainName: vpnVM.instancePublicDnsName,
      deleteExisting: true,
      ttl: cdk.Duration.minutes(1),       // Optional - default is 30 minutes
    });

  }
}
