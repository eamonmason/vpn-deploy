#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { VPNPipelineStack } from '../lib/vpn-pipeline-stack';

const app = new cdk.App();
const pipelineStack = new VPNPipelineStack(app, 'VPNPipelineStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT || '002681522526',
    region: process.env.CDK_DEFAULT_REGION || 'eu-west-1'
  }
});
cdk.Tags.of(pipelineStack).add('application-name', 'wireguard-vpn');

// app.synth();