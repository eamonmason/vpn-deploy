#!/usr/bin/env bash
# Deploys the ASG/VM stack only, not the pipeline
if [[ $# -ge 2 ]]; then
    export RECORD_NAME=$1    
    export ZONE_NAME=$2;    
    shift
    shift    
    npx cdk deploy --require-approval=never "$@" --app "npx ts-node bin/vpn-lambda-deploy.ts"
    exit $?
else
    echo 1>&2 "Usage: vpn-vm-deploy.sh <record-name> <zone-name>
    Provide a DNS record and zone name.
    E.g. vpn.acme.com acme.com"
    exit 1
fi