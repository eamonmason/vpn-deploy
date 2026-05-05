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
