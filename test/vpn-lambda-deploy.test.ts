import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { VPNLambdaDeployStack } from '../lib/vpn-lambda-deploy-stack';

// Skip Docker bundling in unit tests by replacing every Code.fromAsset call with a
// no-bundling asset pointing to a controlled temp directory. Template shape is what matters.
const realFromAsset = jest.requireActual<typeof lambda>('aws-cdk-lib/aws-lambda').Code.fromAsset;
let testAssetDir: string;

beforeAll(() => {
  testAssetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-test-asset-'));
  fs.writeFileSync(path.join(testAssetDir, 'placeholder'), '');
});

afterAll(() => {
  fs.rmSync(testAssetDir, { recursive: true, force: true });
});

beforeEach(() => {
  jest.spyOn(lambda.Code, 'fromAsset').mockImplementation(
    () => realFromAsset(testAssetDir)
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

function makeStack() {
  const app = new cdk.App();
  process.env.CDK_DEFAULT_ACCOUNT = '123456789012';
  process.env.CDK_DEFAULT_REGION = 'eu-west-1';
  process.env.RECORD_NAME = 'vpn';
  process.env.ZONE_NAME = 'example.com';
  return new VPNLambdaDeployStack(app, 'TestLambdaStack', {
    env: { account: '123456789012', region: 'eu-west-1' },
  });
}

test('VPN Starter Proxy Lambda passes API_KEY_PARAM_NAME and has SSM permissions', () => {
  const template = Template.fromStack(makeStack());

  // The Lambda environment should reference the SSM parameter name
  const functions = template.findResources('AWS::Lambda::Function', {
    Properties: { Handler: 'index.handler' },
  });
  const fnProps = Object.values(functions)[0] as { Properties: { Environment?: { Variables?: Record<string, unknown> } } };
  const envVars = fnProps.Properties.Environment?.Variables ?? {};

  expect(envVars).toHaveProperty('API_KEY_PARAM_NAME', '/vpn-starter-proxy/api-key');
  expect(envVars).not.toHaveProperty('SECRET_ARN');
  expect(envVars).not.toHaveProperty('API_KEY');

  // Verify IAM policy for SSM GetParameter
  template.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: [
            'ssm:DescribeParameters',
            'ssm:GetParameters',
            'ssm:GetParameter',
            'ssm:GetParameterHistory'
          ],
          Effect: 'Allow',
          Resource: {
            'Fn::Join': [
              '',
              [
                'arn:',
                { Ref: 'AWS::Partition' },
                ':ssm:eu-west-1:123456789012:parameter/vpn-starter-proxy/api-key'
              ]
            ]
          }
        })
      ])
    }
  });
});

test('No Secrets Manager rotation or secret resource remains', () => {
  const template = Template.fromStack(makeStack());

  template.resourceCountIs('AWS::SecretsManager::Secret', 0);
  template.resourceCountIs('AWS::SecretsManager::RotationSchedule', 0);
});

test('VPN Idle Shutdown Lambda is scheduled every 15 minutes with the expected env vars', () => {
  const template = Template.fromStack(makeStack());

  template.hasResourceProperties('AWS::Events::Rule', {
    ScheduleExpression: 'rate(15 minutes)',
    Targets: Match.arrayWith([
      Match.objectLike({
        Arn: Match.objectLike({ 'Fn::GetAtt': Match.arrayWith([Match.stringLikeRegexp('VPNIdleShutdownFunction')]) }),
      }),
    ]),
  });

  template.hasResourceProperties('AWS::Lambda::Function', {
    Handler: 'vpn_toggle.idle_shutdown.handler',
    Environment: {
      Variables: Match.objectLike({
        MAX_RUNTIME_MINUTES: '120',
        GRACE_PERIOD_MINUTES: '15',
        IDLE_WINDOW_MINUTES: '30',
        IDLE_BYTE_THRESHOLD_BYTES: `${5 * 1024 * 1024}`,
        NOTIFICATION_TOPIC_ARN: Match.anyValue(),
      }),
    },
  });
});

test('VPN Idle Shutdown IAM role is scoped to update/describe ASG state, read CloudWatch metrics, and publish to the notification topic only', () => {
  const template = Template.fromStack(makeStack());

  // The role uses inlinePolicies, which CDK synthesizes onto the AWS::IAM::Role
  // resource's own Policies property, not as separate AWS::IAM::Policy resources.
  template.hasResourceProperties('AWS::IAM::Role', {
    Policies: Match.arrayWith([
      Match.objectLike({
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'autoscaling:UpdateAutoScalingGroup',
              Effect: 'Allow',
              Condition: { StringEquals: { 'aws:ResourceTag/application-name': 'wireguard-vpn' } },
            }),
            Match.objectLike({ Action: 'cloudwatch:GetMetricData', Effect: 'Allow' }),
            Match.objectLike({
              Action: 'sns:Publish',
              Effect: 'Allow',
              Resource: { Ref: Match.stringLikeRegexp('VPNNotificationTopic') },
            }),
          ]),
        },
      }),
    ]),
  });
});

test('VPN Notification Topic has an email subscription and is separate from the inbound VPN-trigger topic', () => {
  const template = Template.fromStack(makeStack());

  template.resourceCountIs('AWS::SNS::Topic', 2);
  template.hasResourceProperties('AWS::SNS::Topic', {
    TopicName: 'vpn-auto-stop-notifications',
  });
  template.hasResourceProperties('AWS::SNS::Subscription', {
    Protocol: 'email',
  });
});

test('VPN Idle Shutdown Lambda has its own log group', () => {
  const template = Template.fromStack(makeStack());

  template.hasResourceProperties('AWS::Logs::LogGroup', {
    LogGroupName: {
      'Fn::Join': [
        '',
        ['/aws/lambda/', { Ref: Match.stringLikeRegexp('VPNIdleShutdownFunction') }],
      ],
    },
  });
});
