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