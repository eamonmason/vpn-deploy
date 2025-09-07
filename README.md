# VPN Deployment

This is CDK to deploy a VPN VM to a standalone VPC in AWS, based on a pre-existing AMI, in region.

Put environment variables in SSM:

```sh
export AWS_REGION=<myregion>
aws ssm put-parameter --name "/vpn-wireguard/AWS_REGION" --value "us-east-1" --type String
aws ssm put-parameter --name "/vpn-wireguard/PRIVATE_IP_CIDR" --value "10.0.0.1/32" --type String
aws ssm put-parameter --name "/vpn-wireguard/PUBLIC_KEY" --value "ssh-rsa xxxxx" --type String
aws ssm put-parameter --name "/vpn-wireguard/WIREGUARD_IMAGE" --value "ami-xxxx" --type String
aws ssm put-parameter --name "/vpn-wireguard/ZONE_NAME" --value "acme.com" --type String
aws ssm put-parameter --name "/vpn-wireguard/RECORD_NAME" --value "vpn.acme.com" --type String
```

Check env vars with:

```sh
export AWS_REGION=<myregion>
aws ssm get-parameter --name "/vpn-wireguard/AWS_REGION"
aws ssm get-parameter --name "/vpn-wireguard/PRIVATE_IP_CIDR"
aws ssm get-parameter --name "/vpn-wireguard/PUBLIC_KEY"
aws ssm get-parameter --name "/vpn-wireguard/WIREGUARD_IMAGE"
aws ssm get-parameter --name "/vpn-wireguard/ZONE_NAME"
aws ssm get-parameter --name "/vpn-wireguard/RECORD_NAME"
```

Run the deployment pipeline:

```sh
cdk deploy --all --app "npx ts-node bin/pipeline-cdk.ts"
```
