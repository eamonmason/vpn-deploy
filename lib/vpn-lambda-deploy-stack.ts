import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { SnsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';

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
                actions: ['ec2:*', 'autoscaling:*'],
                conditions: {
                  "StringEquals": {"aws:ResourceTag/application-name": "wireguard-vpn"}
                },
                resources: ['*'],
              }),
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['autoscaling:DescribeAutoScalingGroups', 'autoscaling:DescribeAutoScalingInstances', 'ec2:DescribeInstances', 'ec2:DescribeSecurityGroups'],
                resources: ['*'],
              }),
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['route53:listHostedZonesByName', 'route53:changeResourceRecordSets','route53:listResourceRecordSets'],
                resources: ['*'],
              })
            ]
          })
      }});

      const layer = new lambda.LayerVersion(this, 'VPNLibsLayer', {
        code: lambda.Code.fromAsset('.', {
          exclude: ['*.pyc'],
          bundling: {
            image: lambda.Runtime.PYTHON_3_11.bundlingImage,
            user: "root",
            command: [
              'bash', '-c',
              'cd /asset-input && pip install poetry && poetry self add poetry-plugin-export && poetry export -f requirements.txt --without-hashes > layer_requirements.txt && \
              mkdir -p /asset-output/python/lib/python3.11/site-packages/ && pip install -r layer_requirements.txt --no-cache-dir --no-deps -t /asset-output/python/lib/python3.11/site-packages/ . && rm -r /asset-output/python/lib/python3.11/site-packages/vpn_toggle*'
            ]
          }
        })
      });

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

      // VPN Idle Shutdown Lambda Function
      // Runs on a schedule; auto-stops any region's VPN that has been idle or has
      // exceeded a hard runtime cap, so a forgotten VPN doesn't rack up compute costs.
      const notificationEmail = ssm.StringParameter.valueForStringParameter(this, '/vpn-wireguard/NOTIFICATION_EMAIL');

      const notificationTopic = new sns.Topic(this, 'VPNNotificationTopic', {
        topicName: 'vpn-auto-stop-notifications',
        displayName: 'VPN Auto-Stop Notifications',
      });
      notificationTopic.addSubscription(new subscriptions.EmailSubscription(notificationEmail));

      const idleShutdownRole = new iam.Role(this, 'VPNIdleShutdownRole', {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        ],
        inlinePolicies: {
          'policy': new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['autoscaling:UpdateAutoScalingGroup'],
                conditions: {
                  "StringEquals": {"aws:ResourceTag/application-name": "wireguard-vpn"}
                },
                resources: ['*'],
              }),
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['autoscaling:DescribeAutoScalingGroups', 'autoscaling:DescribeAutoScalingInstances', 'ec2:DescribeInstances'],
                resources: ['*'],
              }),
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['cloudwatch:GetMetricData'],
                resources: ['*'],
              }),
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['sns:Publish'],
                resources: [notificationTopic.topicArn],
              }),
            ]
          })
      }});

      const idleShutdownFunction = new lambda.Function(this, 'VPNIdleShutdownFunction', {
        code: new lambda.AssetCode('src'),
        handler: 'vpn_toggle.idle_shutdown.handler',
        runtime: lambda.Runtime.PYTHON_3_11,
        environment: {
          NOTIFICATION_TOPIC_ARN: notificationTopic.topicArn,
          MAX_RUNTIME_MINUTES: '120',
          GRACE_PERIOD_MINUTES: '15',
          IDLE_WINDOW_MINUTES: '30',
          IDLE_BYTE_THRESHOLD_BYTES: `${5 * 1024 * 1024}`,
        },
        role: idleShutdownRole,
        layers: [layer],
        timeout: cdk.Duration.seconds(180)
      });

      const idleShutdownLogGroup = new logs.LogGroup(this, 'VPNIdleShutdownLogGroup', {
        logGroupName: `/aws/lambda/${idleShutdownFunction.functionName}`,
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY
      });

      const idleShutdownSchedule = new events.Rule(this, 'VPNIdleShutdownSchedule', {
        schedule: events.Schedule.rate(cdk.Duration.minutes(15)),
        description: 'Periodically checks all VPN regions for idle traffic or max-runtime breach and auto-stops them.',
      });
      idleShutdownSchedule.addTarget(new targets.LambdaFunction(idleShutdownFunction));

      // VPN Starter Proxy Lambda Function
      // Retrieve API key from SSM Parameter Store (SecureString)
      // Note: Initial value must be set manually or via AWS CLI after first deployment if not already present.
      const apiKeyParamName = '/vpn-starter-proxy/api-key';
      const apiKeyParameter = ssm.StringParameter.fromSecureStringParameterAttributes(this, 'VPNStarterProxyApiKeyParam', {
        parameterName: apiKeyParamName,
      });

      // IAM role for VPN Starter Proxy Lambda
      const starterProxyRole = new iam.Role(this, 'VPNStarterProxyRole', {
        assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
        ],
        inlinePolicies: {
          'sns-publish': new iam.PolicyDocument({
            statements: [
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ['sns:Publish'],
                resources: [receive_topic.topicArn],
              }),
            ],
          }),
        },
      });

      // Grant read access to the SSM parameter
      apiKeyParameter.grantRead(starterProxyRole);

      // VPN Starter Proxy Lambda function
      const starterProxyFunction = new lambda.Function(this, 'VPNStarterProxyFunction', {
        code: lambda.Code.fromAsset('src/vpn_starter_proxy', {
          bundling: {
            image: lambda.Runtime.NODEJS_22_X.bundlingImage,
            user: 'root',
            command: [
              'bash', '-c',
              'cp -r /asset-input/* /asset-output/ && ' +
              'cd /asset-output && ' +
              'npm install && ' +
              'npx tsc && ' +
              'npm prune --production'
            ],
          },
        }),
        handler: 'index.handler',
        runtime: lambda.Runtime.NODEJS_22_X,
        environment: {
          TOPIC_ARN: receive_topic.topicArn,
          API_KEY_PARAM_NAME: apiKeyParamName,
        },
        role: starterProxyRole,
        timeout: cdk.Duration.seconds(30),
        memorySize: 256,
      });

      // Log group for VPN Starter Proxy Lambda
      const starterProxyLogGroup = new logs.LogGroup(this, 'VPNStarterProxyLogGroup', {
        logGroupName: `/aws/lambda/${starterProxyFunction.functionName}`,
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      // API Gateway REST API
      const api = new apigateway.RestApi(this, 'VPNStarterProxyAPI', {
        restApiName: 'VPN Starter Proxy API',
        description: 'API Gateway for VPN Starter Proxy Lambda function',
        deployOptions: {
          stageName: 'prod',
          loggingLevel: apigateway.MethodLoggingLevel.INFO,
          // Full request/response data trace would log the X-Api-Key header and
          // apiKey body field to CloudWatch Logs in clear text - keep it off.
          dataTraceEnabled: false,
          tracingEnabled: true,
          metricsEnabled: true,
        },
        defaultCorsPreflightOptions: {
          allowOrigins: apigateway.Cors.ALL_ORIGINS,
          allowMethods: ['POST', 'OPTIONS'],
          allowHeaders: ['Content-Type', 'X-Api-Key'],
        },
        cloudWatchRole: true,
      });

      // API Gateway integration with Lambda
      const integration = new apigateway.LambdaIntegration(starterProxyFunction, {
        requestTemplates: { 'application/json': '{ "statusCode": "200" }' },
      });

      // Add resource and method to API Gateway
      const vpnResource = api.root.addResource('start-vpn');
      vpnResource.addMethod('POST', integration, {
        apiKeyRequired: false, // API key validation is handled in Lambda
      });

      // Add usage plan for rate limiting
      const usagePlan = api.addUsagePlan('VPNStarterProxyUsagePlan', {
        name: 'VPN Starter Proxy Usage Plan',
        throttle: {
          rateLimit: 10, // requests per second
          burstLimit: 20, // maximum concurrent requests
        },
        quota: {
          limit: 1000, // requests per period
          period: apigateway.Period.DAY,
        },
      });

      usagePlan.addApiStage({
        stage: api.deploymentStage,
      });

      // Output the API endpoint and SSM parameter name
      new cdk.CfnOutput(this, 'VPNStarterProxyApiEndpoint', {
        value: `${api.url}start-vpn`,
        description: 'VPN Starter Proxy API Endpoint',
        exportName: 'VPNStarterProxyApiEndpoint',
      });

      new cdk.CfnOutput(this, 'VPNStarterProxyApiKeyParamName', {
        value: apiKeyParamName,
        description: 'Name of the SSM parameter containing the API key',
        exportName: 'VPNStarterProxyApiKeyParamName',
      });
  }
}
