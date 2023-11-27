import * as cdk from 'aws-cdk-lib';
import { Construct } from "constructs";
import { VPNLambdaDeployStack } from '../lib/vpn-lambda-deploy-stack';

export class VPNPipelineLambdaStage extends cdk.Stage {

    constructor(scope: Construct, id: string, props?: cdk.StageProps) {
      super(scope, id, props);

      const vpnDeployStack = new VPNLambdaDeployStack(this, 'VPNLambdaDeployStack');
    }
}