import * as cdk from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { CodePipeline, CodePipelineSource, CodeBuildStep } from 'aws-cdk-lib/pipelines';
import { VPNPipelineAppStage } from './vpn-pipeline-app-stage';
import { VPNPipelineLambdaStage } from './vpn-pipeline-lambda-stage';
import { ManualApprovalStep } from 'aws-cdk-lib/pipelines';
import {BuildEnvironmentVariableType} from 'aws-cdk-lib/aws-codebuild';
import * as iam from 'aws-cdk-lib/aws-iam';

export class VPNPipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const roleToAssume = new iam.Role(this, 'VPNPipelineRole'
    , {
      // assumedBy: new iam.AccountRootPrincipal()
      assumedBy: new iam.ServicePrincipal("codebuild.amazonaws.com"),
    }
    );
    roleToAssume.addToPolicy(new iam.PolicyStatement({ actions: [`*`], resources: [`*`]}));
    

    const pipeline = new CodePipeline(this, 'Pipeline', {
      pipelineName: 'VPNPipeline',
      synth: new CodeBuildStep('Synth', {
        input: CodePipelineSource.connection('eamonmason/vpn-deploy', 'main', {
          connectionArn: `arn:aws:codeconnections:${this.region}:${this.account}:connection/18ff9d6f-e1c9-4482-8ece-f2c4b275841e`
        }),
        commands: [
          'npm ci',          
          'npx cdk synth',
        ],
        buildEnvironment: {
          environmentVariables: {
            PRIVATE_IP_CIDR: { value: '/vpn-wireguard/PRIVATE_IP_CIDR', type: BuildEnvironmentVariableType.PARAMETER_STORE},
            ZONE_NAME: { value: '/vpn-wireguard/ZONE_NAME', type: BuildEnvironmentVariableType.PARAMETER_STORE},
            RECORD_NAME: { value: '/vpn-wireguard/RECORD_NAME', type: BuildEnvironmentVariableType.PARAMETER_STORE},
            WIREGUARD_IMAGE: { value: '/vpn-wireguard/WIREGUARD_IMAGE', type: BuildEnvironmentVariableType.PARAMETER_STORE},
            PUBLIC_KEY: { value: '/vpn-wireguard/PUBLIC_KEY', type: BuildEnvironmentVariableType.PARAMETER_STORE},
          },
          // privileged: true,          
        },
        role: roleToAssume        
      }),      
    });


    // const targetRegion = ssm.StringParameter.valueFromLookup(this, '/vpn-wireguard/AWS_REGION')
    const regions = ["us-east-1", "eu-west-2", "eu-north-1", "ap-southeast-2", "ca-central-1"]
    for (var region of regions) {
      
      const vpn_app_stage = new VPNPipelineAppStage(this, `cd-vpn-${ region }`, {
        env: {
          account: process.env.CDK_DEFAULT_ACCOUNT,
          region: region
        }
      })
      cdk.Tags.of(vpn_app_stage).add('application-name', 'wireguard-vpn');
      pipeline.addStage(vpn_app_stage);
    }

    const vpn_lambda_stage = new VPNPipelineLambdaStage(this, 'cd-lambda');    
    cdk.Tags.of(vpn_lambda_stage).add('application-name', 'wireguard-vpn');
    pipeline.addStage(vpn_lambda_stage);

  }
}