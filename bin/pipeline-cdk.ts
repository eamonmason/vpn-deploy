#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { VPNPipelineStack } from '../lib/vpn-pipeline-stack';

const app = new cdk.App();
new VPNPipelineStack(app, 'VPNPipelineStack', {
  env: {
    account: process.env.AWS_ACCOUNT_ID,
    region: process.env.AWS_REGION
  }
});

app.synth();