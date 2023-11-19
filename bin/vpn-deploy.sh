#!/usr/bin/env bash
if [[ $# -ge 4 ]]; then
    export PRIVATE_IP_CIDR=$1    
    export ZONE_NAME=$2;
    export WIREGUARD_IMAGE=$3;
    export PUBLIC_KEY=$4;
    shift
    shift
    shift
    shift
    npx cdk deploy "$@"
    exit $?
else
    echo 1>&2 "Provide a private IP CIDR, e.g. 10.0.0.1/32. Zone name, e.g. acme.com, image name, e.g. WireguardImage, and Public Key"    
    exit 1
fi