# VPN Deployment

This is CDK to deploy a VPN VM to a standalone VPC in AWS, based on a pre-existing AMI, in region.

Put environment variables in SSM:

```sh
aws ssm put-parameter --name "/vpn-wireguard/AWS_REGION" --value "us-east-1" --type String
aws ssm put-parameter --name "/vpn-wireguard/PRIVATE_IP_CIDR" --value "10.0.0.1/32" --type String
aws ssm put-parameter --name "/vpn-wireguard/PUBLIC_KEY" --value "ssh-rsa xxxxx" --type String
aws ssm put-parameter --name "/vpn-wireguard/WIREGUARD_IMAGE" --value "wireguard-server-2023-11-21-1150" --type SecureString
aws ssm put-parameter --name "/vpn-wireguard/ZONE_NAME" --value "acme.com" --type String
```

Run the deployment pipeline:

```sh
cdk deploy --app "npx ts-node bin/pipeline-cdk.ts"
```
