import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { SnsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';

export class VPNLambdaDeployStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const a_record_name = process.env.RECORD_NAME || '';
    const domain_name = process.env.ZONE_NAME || '';    
    
    const receive_topic = new sns.Topic(this, process.env.CDK_DEFAULT_REGION || '');
    const MyTopicPolicy = new sns.TopicPolicy(this, 'VPNTopicSNSPolicy', {
        topics: [receive_topic],
      });
  
      MyTopicPolicy.document.addStatements(new iam.PolicyStatement({
        sid: "0",
        actions: ["SNS:Publish"],
        principals: [new iam.ServicePrincipal('ses.amazonaws.com')],
        resources: [receive_topic.topicArn],
        conditions:
          {
            "StringEquals": {
              "AWS:SourceAccount": process.env.CDK_DEFAULT_ACCOUNT,
            },
            "StringLike": {
              "AWS:SourceArn": "arn:aws:ses:*"
            }
          }
        }
      ));

      const role = new iam.Role(this, 'VPNLambdaRole', {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        ],
        inlinePolicies: {
          'policy': new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['ec2:*', 'autoscaling:*', 's3:ListBucket', 's3:ListObjects'],
                conditions: {
                  "StringEquals": {"aws:ResourceTag/application-name": "wireguard-vpn"}
                },
                resources: ['*'],
              }),
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['route53:listHostedZonesByName', 'route53:changeResourceRecordSets','route53:listResourceRecordSets'],
                resources: ['arn:aws:route53:::hostedzone/*', 'arn:aws:route53:::change/*'],
              })
            ]
          })
      }});

      const layer = new lambda.LayerVersion(this, 'VPNLibsLayer', {
        code: lambda.Code.fromAsset('.', {
          exclude: ['*.pyc'],
          bundling: {
            image: lambda.Runtime.PYTHON_3_11.bundlingImage,
            command: [
              'bash', '-c',
              'mkdir -p /asset-output/python/lib/python3.11/site-packages/ && pip install -t /asset-output/python/lib/python3.11/site-packages/ . && rm -r /asset-output/python/lib/python3.11/site-packages/vpn_toggle*'
            ],
          }
        }
        )
      })

      const VPNToggleFunction = new lambda.Function(this, 'VPNToggleFunction', {
        code: new lambda.AssetCode('src'),
        handler: 'vpn_toggle.vpn_toggle.handler',
        runtime: lambda.Runtime.PYTHON_3_11,
        environment: {
          A_RECORD_NAME: a_record_name,
          DOMAIN_NAME: domain_name
        },
        role: role,
        layers: [layer],
        timeout: cdk.Duration.seconds(180)
      });
      VPNToggleFunction.addEventSource(new SnsEventSource(receive_topic));

      const vpnToggleLogGroup = new logs.LogGroup(this, 'vpnToggleLogGroup', {
        logGroupName: `/aws/lambda/${VPNToggleFunction.functionName}`,
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY
      });
      vpnToggleLogGroup.grantWrite(role);
  }
}
