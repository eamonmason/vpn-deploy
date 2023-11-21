#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { VpnPipelineStack } from '../lib/vpn_pipeline_stack';

const app = new cdk.App();
new VpnPipelineStack(app, 'VPNPipelineStack', {
  env: {
    account: process.env.AWS_ACCOUNT_ID,
    region: process.env.AWS_REGION
  }
});

app.synth();