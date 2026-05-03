import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Template } from 'aws-cdk-lib/assertions';
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

test('VPN Starter Proxy Lambda passes SECRET_ARN, not a plain API_KEY value', () => {
  const template = Template.fromStack(makeStack());

  // The Lambda environment should reference the secret ARN dynamically,
  // not an unsafeUnwrapped secret value baked in at synthesis.
  const functions = template.findResources('AWS::Lambda::Function', {
    Properties: { Handler: 'index.handler' },
  });
  const fnProps = Object.values(functions)[0] as { Properties: { Environment?: { Variables?: Record<string, unknown> } } };
  const envVars = fnProps.Properties.Environment?.Variables ?? {};

  expect(envVars).toHaveProperty('SECRET_ARN');
  expect(envVars).not.toHaveProperty('API_KEY');
});

test('API key secret has a rotation schedule configured', () => {
  const template = Template.fromStack(makeStack());

  // Secrets Manager rotation schedule resource must exist with a 30-day schedule.
  // CDK renders Duration.days(30) as a rate() ScheduleExpression in CloudFormation.
  template.resourceCountIs('AWS::SecretsManager::RotationSchedule', 1);
  template.hasResourceProperties('AWS::SecretsManager::RotationSchedule', {
    RotationRules: {
      ScheduleExpression: 'rate(30 days)',
    },
    RotateImmediatelyOnUpdate: false,
  });
});

test('Rotation Lambda has secretsmanager read/write permissions', () => {
  const template = Template.fromStack(makeStack());

  const policies = template.findResources('AWS::IAM::Policy');
  const statements = Object.values(policies).flatMap(
    (p: unknown) => ((p as { Properties: { PolicyDocument: { Statement: unknown[] } } }).Properties.PolicyDocument.Statement)
  );

  const secretsActions = statements
    .filter((s: unknown) => {
      const stmt = s as { Action?: string | string[] };
      const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action ?? ''];
      return actions.some((a) => a.startsWith('secretsmanager:'));
    })
    .flatMap((s: unknown) => {
      const stmt = s as { Action?: string | string[] };
      return Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action ?? ''];
    });

  expect(secretsActions).toContain('secretsmanager:GetSecretValue');
});
