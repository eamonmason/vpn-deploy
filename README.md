# VPN Deploy

This project deploys a WireGuard VPN infrastructure using AWS CDK, with automated management via Lambda functions and a user-friendly API for starting VPN instances.

## Table of Contents

- [User Guide](#user-guide)
  - [Using the VPN Starter API](#using-the-vpn-starter-api)
  - [iOS Shortcuts Integration](#ios-shortcuts-integration)
  - [Getting Your API Key](#getting-your-api-key)
- [Infrastructure Guide](#infrastructure-guide)
  - [Architecture Overview](#architecture-overview)
  - [Prerequisites](#prerequisites)
  - [Deployment](#deployment)
  - [Development](#development)

---

## User Guide

### Using the VPN Starter API

The VPN Starter Proxy provides a simple HTTP API to start VPN instances and whitelist your IP address.

**API Endpoint:**

```
POST /prod/start-vpn
```

**Request Headers:**

```
Content-Type: application/json
X-Api-Key: <your-api-key>
```

**Request Body:**

```json
{
  "region": "eu-west-1",
  "whitelist_ip": "1.2.3.4"
}
```

**Available Regions:**

- `eu-west-1` - Europe (Ireland)
- `us-east-1` - US East (N. Virginia)
- `ap-southeast-2` - Asia Pacific (Sydney)

**Example using curl:**

```bash
curl -X POST "https://your-api-gateway-url/prod/start-vpn" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: your-api-key" \
  -d '{
    "region": "eu-west-1",
    "whitelist_ip": "1.2.3.4"
  }'
```

**Success Response:**

```json
{
  "success": true,
  "messageId": "abc123...",
  "message": "VPN start message sent successfully",
  "region": "eu-west-1",
  "ip": "1.2.3.4"
}
```

**Error Response:**

```json
{
  "error": "Invalid IP address format"
}
```

### iOS Shortcuts Integration

To create an iOS Shortcut for starting your VPN:

1. **Get your API endpoint and key** (see below)

2. **Create a new Shortcut:**
   - Open the Shortcuts app on your iPhone/iPad
   - Tap the "+" button to create a new shortcut
   - Add a "Get Contents of URL" action

3. **Configure the URL action:**
   - URL: `https://your-api-gateway-url/prod/start-vpn`
   - Method: `POST`
   - Headers:
     - Add Header: `X-Api-Key` with value `your-api-key`
     - Add Header: `Content-Type` with value `application/json`
   - Request Body: `JSON`
   - JSON structure:
     ```json
     {
       "region": "eu-west-1",
       "whitelist_ip": "Get Current IP Address"
     }
     ```

4. **Add response handling** (optional):
   - Add a "Show Result" action to display the API response
   - Add a "Show Notification" action for success/failure

5. **Name your shortcut** (e.g., "Start VPN - EU West")

6. **Add to Home Screen** for quick access

### Getting Your API Key

**Option 1: AWS Console**

1. Go to AWS Secrets Manager console
2. Find the secret named `vpn-starter-proxy-api-key`
3. Click "Retrieve secret value"
4. Copy the `apiKey` value

**Option 2: AWS CLI**

```bash
aws secretsmanager get-secret-value \
  --secret-id vpn-starter-proxy-api-key \
  --query SecretString \
  --output text | jq -r .apiKey
```

**Option 3: CloudFormation Outputs**

The API endpoint URL is available in the CloudFormation stack outputs:

```bash
aws cloudformation describe-stacks \
  --stack-name VPNPipelineStack \
  --query "Stacks[0].Outputs[?OutputKey=='VPNStarterProxyApiEndpoint'].OutputValue" \
  --output text
```

---

## Infrastructure Guide

### Architecture Overview

The infrastructure consists of three main components:

#### 1. **VPN VM Infrastructure**

WireGuard VPN instances deployed across multiple AWS regions:

- us-east-1 (US East - N. Virginia)
- eu-west-2 (Europe - London)
- eu-north-1 (Europe - Stockholm)
- ap-southeast-2 (Asia Pacific - Sydney)

#### 2. **VPN Toggle Lambda Function** (Python)

Manages VPN lifecycle operations:

- Starts/stops VPN instances based on demand
- Updates Route53 DNS records for VPN endpoints
- Manages security group rules for IP whitelisting
- Triggered by SNS topics from email or API requests

**Location:** `src/vpn_toggle/`

#### 3. **VPN Starter Proxy Lambda Function** (TypeScript)

Provides HTTP API endpoint for starting VPN instances:

- RESTful API via Amazon API Gateway
- Publishes messages to SNS topic to trigger VPN Toggle Lambda
- Secure API key authentication (AWS Secrets Manager)
- Input validation and sanitization
- Rate limiting and throttling
- CORS support for web clients

**Location:** `src/vpn_starter_proxy/`

**Security Features:**

- Auto-generated 32-character API key
- Least-privilege IAM permissions (SNS:Publish only)
- Input sanitization to prevent injection attacks
- IP address format validation (IPv4 and IPv6)
- Region whitelist enforcement
- API Gateway rate limiting:
  - 10 requests/second rate limit
  - 20 burst capacity
  - 1000 requests/day quota

### Prerequisites

**Required:**

- Node.js 20.x or later
- Python 3.11
- Docker (Rancher Desktop or Docker Desktop)
- AWS CDK CLI (`npm install -g aws-cdk`)
- AWS CLI configured with appropriate credentials

**AWS Permissions Required:**

- CloudFormation full access
- Lambda full access
- API Gateway full access
- SNS full access
- Secrets Manager full access
- IAM role/policy creation
- EC2 (for VPN instances)
- Route53 (for DNS management)

### Deployment

#### Initial Setup

1. **Clone the repository:**

   ```bash
   git clone <repository-url>
   cd vpn-deploy
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Set environment variables:**

   ```bash
   export AWS_PROFILE=personal
   export RECORD_NAME=vpn
   export ZONE_NAME=yourdomain.com
   ```

4. **Compile the VPN Starter Proxy Lambda:**

   ```bash
   cd src/vpn_starter_proxy
   npm install
   npx tsc
   cd ../..
   ```

#### Deploy Infrastructure

**Deploy all stacks:**

```bash
AWS_PROFILE=personal npm run cdk deploy -- --all
```

**Deploy specific stack:**

```bash
AWS_PROFILE=personal npm run cdk deploy VPNPipelineStack
```

**Note:** The deployment uses a CDK Pipeline for continuous deployment. Changes pushed to the repository will automatically trigger deployments through AWS CodePipeline.

#### Post-Deployment

After successful deployment, note the following outputs:

- **VPNStarterProxyApiEndpoint**: The API Gateway endpoint URL
- **VPNStarterProxyApiKeySecretArn**: ARN of the Secrets Manager secret

### Development

#### Project Structure

```
vpn-deploy/
├── bin/                              # CDK app entry points
│   └── pipeline-cdk.ts               # Pipeline CDK app
├── lib/                              # CDK stack definitions
│   ├── vpn-lambda-deploy-stack.ts    # Lambda functions stack
│   ├── vpn-pipeline-stack.ts         # CI/CD pipeline stack
│   └── ...
├── src/
│   ├── vpn_toggle/                   # Python VPN toggle Lambda
│   │   ├── vpn_toggle.py             # Lambda handler
│   │   └── pyproject.toml            # Python dependencies
│   └── vpn_starter_proxy/            # TypeScript VPN starter proxy Lambda
│       ├── index.ts                  # Lambda handler source
│       ├── index.js                  # Compiled JavaScript
│       ├── package.json              # Node.js dependencies
│       └── tsconfig.json             # TypeScript configuration
├── cdk.json                          # CDK configuration
├── package.json                      # Node.js dependencies
└── tsconfig.json                     # TypeScript configuration
```

#### Local Development

**Building the VPN Starter Proxy Lambda:**

```bash
cd src/vpn_starter_proxy
npm install
npx tsc
```

**Running unit tests:**

```bash
npm test
```

**Synthesize CDK templates:**

```bash
npx cdk synth
```

**Compare deployed stack with current state:**

```bash
npx cdk diff
```

### Monitoring and Logging

**CloudWatch Log Groups:**

- VPN Toggle Lambda: `/aws/lambda/VPNToggleFunction`
- VPN Starter Proxy Lambda: `/aws/lambda/VPNStarterProxyFunction`
- API Gateway: Enabled with full request/response logging

**View logs:**

```bash
# VPN Starter Proxy logs
aws logs tail /aws/lambda/VPNStarterProxyFunction --follow

# VPN Toggle logs
aws logs tail /aws/lambda/VPNToggleFunction --follow
```

**CloudWatch Metrics:**

- Lambda invocations, duration, errors
- API Gateway requests, 4xx/5xx errors, latency
- SNS published messages

### Troubleshooting

**API returns 401 Unauthorized:**

- Verify API key is correct
- Check API key is passed in `X-Api-Key` header

**API returns 400 Bad Request:**

- Ensure region is one of: `eu-west-1`, `us-east-1`, `ap-southeast-2`
- Verify IP address is in valid IPv4 or IPv6 format
- Check JSON request body is properly formatted

**VPN doesn't start:**

- Check VPN Toggle Lambda logs for errors
- Verify SNS topic permissions
- Ensure VPN instances exist in the specified region

**Deployment fails:**

- Ensure Docker is running (required for Lambda bundling)
- Check AWS credentials are configured correctly
- Verify IAM permissions are sufficient

### Updating the Infrastructure

1. Make changes to CDK stacks or Lambda code
2. Compile TypeScript Lambda if modified:
   ```bash
   cd src/vpn_starter_proxy && npx tsc && cd ../..
   ```
3. Deploy changes:
   ```bash
   AWS_PROFILE=personal npm run cdk deploy -- --all
   ```

### Security Considerations

- **API Key Rotation**: Rotate API keys periodically through Secrets Manager
- **IP Whitelisting**: Only whitelist trusted IP addresses
- **Rate Limiting**: Adjust API Gateway throttling as needed
- **Monitoring**: Set up CloudWatch alarms for unusual activity
- **Least Privilege**: Lambda functions have minimal required permissions

### Cost Optimization

- VPN instances are started on-demand and can be configured to auto-stop
- Lambda functions only incur costs when invoked
- API Gateway charges per request
- Consider Reserved Instances for always-on VPN instances

### License

This project is private and proprietary.
