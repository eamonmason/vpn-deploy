#!/usr/bin/env bash


if [[ $# -ge 3 ]]; then

    
    export AWS_PROFILE=$1
    export AWS_REGION=$2
    ZONE_NAME=$3
    TAG_VALUE="wireguard-vpn"
    
    ASG_NAME=$(aws autoscaling describe-auto-scaling-groups --filters "Name=tag:application-name,Values=${TAG_VALUE}" --query "AutoScalingGroups[0].AutoScalingGroupName" --output text)
    ASG_CAPACITY=$(aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names $ASG_NAME --query "AutoScalingGroups[0].DesiredCapacity" --output text)
    # Update the ASG to desired capacity of 1 or switch it off if already at 1
    if [[ $ASG_CAPACITY == "1" ]]; then
        echo "Switching off the VPN"
        aws autoscaling update-auto-scaling-group --desired-capacity 0 --auto-scaling-group-name $ASG_NAME
        exit $?
    else
        echo "Switching on the VPN"
        aws autoscaling update-auto-scaling-group --desired-capacity 1 --auto-scaling-group-name $ASG_NAME
        echo "Waiting for the VPN to start" 
        sleep 10
        INSTANCE_ID=$(aws autoscaling describe-auto-scaling-instances --query "AutoScalingInstances[?AutoScalingGroupName=='${ASG_NAME}'].InstanceId" --output text)
        PUBLIC_IP=$(aws ec2 describe-instances --instance-ids $INSTANCE_ID --query "Reservations[0].Instances[0].NetworkInterfaces[0].Association.PublicIp" --output text)
        echo "Public IP: $PUBLIC_IP"
        ZONE_ID=$(aws route53 list-hosted-zones-by-name --dns-name "$ZONE_NAME" --query "HostedZones[0].Id" --output text | cut -d'/' -f3)
    fi
    # aws route53 change-resource-record-sets --hosted-zone-id $ZONE_ID --change-batch '{"Changes": [ { "Action": "UPSERT", "ResourceRecordSet": { "Name": "vpn.tobiasmasonvanes.com", "Type": "A", "TTL": 3600, "ResourceRecords": [{ "Value": "11.222.33.44" }] } } ]}'
    exit $?
else
    echo 1>&2 "Syntax: <AWS_PROFILE> <AWS_REGION> <ZONE_NAME>"
    exit 1
fi


#!/usr/bin/env bash
# Deploys the ASG/VM stack only, not the pipeline
if [[ $# -ge 4 ]]; then
    export PRIVATE_IP_CIDR=$1    
    export ZONE_NAME=$2;
    export WIREGUARD_IMAGE=$3;
    export PUBLIC_KEY=$4;
    shift
    shift
    shift
    shift
    npx cdk deploy "$@" --app "npx ts-node bin/vpn-deploy.ts"
    exit $?
else
    echo 1>&2 "Provide a private IP CIDR, e.g. PRIVATE_IP_CIDR=10.0.0.1/32. \
     Zone name e.g. ZONE_NAME=acme.com, \
    image name, e.g. WIREGUARD_IMAGE=WireguardImage, \
    and Public Key, e.g. PUBLIC_KEY=publickey."
    exit 1
fi