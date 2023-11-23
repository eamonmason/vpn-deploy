import * as cdk from 'aws-cdk-lib';
import { Construct } from "constructs";
import { VPNVMDeployStack } from '../lib/vpn-vm-deploy-stack';

export class VPNPipelineAppStage extends cdk.Stage {

    constructor(scope: Construct, id: string, props?: cdk.StageProps) {
      super(scope, id, props);

      const vpnDeployStack = new VPNVMDeployStack(this, 'VPNVMDeployStack');
    }
}