# VPN Deployment

This is CDK to deploy a VPN VM to a standalone VPC in AWS, based on a pre-existing AMI, in region.

Put environment variables in SSM:

```sh
/vpn-wireguard/AWS_REGION
/vpn-wireguard/PRIVATE_IP_CIDR
/vpn-wireguard/PUBLIC_KEY
/vpn-wireguard/WIREGUARD_IMAGE
/vpn-wireguard/ZONE_NAME
```

Run the deployment pipeline:

```sh
cdk deploy --app "npx ts-node bin/pipeline-cdk.ts"
```
