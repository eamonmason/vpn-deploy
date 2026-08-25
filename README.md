# VPN Deploy

This project deploys a WireGuard VPN infrastructure using AWS CDK, with automated management via Lambda functions and a user-friendly API for starting VPN instances.

## Table of Contents

- [User Guide](#user-guide)
  - [Using the VPN Starter API](#using-the-vpn-starter-api)
  - [iOS Shortcuts Integration](#ios-shortcuts-integration)
  - [WireGuard Client Configuration](#wireguard-client-configuration)
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

`whitelist_ip` must be **your own current public IPv4 or IPv6 address**
(not the VPN server's) — it's added to the WireGuard instance's security
group so only that address can connect. If it's stale or wrong, the VPN
starts but you won't be able to reach it. To find your current public IP:

```bash
curl -s https://checkip.amazonaws.com
```

The iOS Shortcut instead uses the built-in "Get Current IP Address"
action (see [iOS Shortcuts Integration](#ios-shortcuts-integration)
below) so this is filled in automatically each run.

**Available Regions:**

| Region code | Friendly name |
|---|---|
| `eu-west-1` | Europe (Ireland) |
| `eu-west-2` | Europe (London) |
| `eu-west-3` | Europe (Paris) |
| `eu-north-1` | Europe (Stockholm) |
| `us-east-1` | US East (N. Virginia) |
| `ap-southeast-2` | Asia Pacific (Sydney) |
| `ca-central-1` | Canada (Central) |
| `none` | None (turn off all VPN VMs) |

**Example using curl:**

```bash
MY_IP=$(curl -s https://checkip.amazonaws.com)

curl -X POST "https://your-api-gateway-url/prod/start-vpn" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: your-api-key" \
  -d "{
    \"region\": \"eu-west-2\",
    \"whitelist_ip\": \"${MY_IP}\"
  }"
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

3. **Add a region menu (with friendly names) above the URL action:**
   - Add a **Choose from Menu** action; set its prompt to something like
     "Choose VPN Region".
   - Add one menu item per row below, with the item's **title** set to
     the friendly name (this is the label you'll see when the shortcut
     runs):

     | Menu item title (friendly name) | `Region` variable value |
     |---|---|
     | Europe (Ireland) | `eu-west-1` |
     | Europe (London) | `eu-west-2` |
     | Europe (Paris) | `eu-west-3` |
     | Europe (Stockholm) | `eu-north-1` |
     | US East (N. Virginia) | `us-east-1` |
     | Asia Pacific (Sydney) | `ap-southeast-2` |
     | Canada (Central) | `ca-central-1` |
     | None (turn off VPN) | `none` |

   - Under **each** menu item's branch, add a **Set Variable** action
     that creates/overwrites a variable named `Region` with that item's
     region code from the table above.

4. **Configure the URL action** (below the menu, so all branches merge
   into it):
   - URL: `https://your-api-gateway-url/prod/start-vpn`
   - Method: `POST`
   - Headers:
     - Add Header: `X-Api-Key` with value `your-api-key`
     - Add Header: `Content-Type` with value `application/json`
   - Request Body: `JSON`
   - JSON structure — insert the `Region` variable (as a variable chip,
     not typed text) for the `region` value:
     ```json
     {
       "region": "{Region}",
       "whitelist_ip": "Get Current IP Address"
     }
     ```

5. **Add response handling** (optional):
   - Add a "Show Result" action to display the API response
   - Add a "Show Notification" action for success/failure

6. **Name your shortcut** (e.g., "Start VPN")

7. **Add to Home Screen** for quick access

### WireGuard Client Configuration

The DNS record the tunnel connects to (`A_RECORD_NAME`, see
`lib/vpn-lambda-deploy-stack.ts:18,92`) is a single shared alias that the
VPN Toggle Lambda repoints to whichever region's instance was last started
(`set_dns_alias` in `src/vpn_toggle/aws_helpers.py`) — **one client
profile covers every region**; you don't need a separate profile per
region, and switching regions via the shortcut/API just changes what the
existing profile's `Endpoint` hostname resolves to.

Recommended `[Interface]` settings, based on troubleshooting a slow/
stalling connection:

```
[Interface]
PrivateKey = <your private key>
Address = 10.0.0.x/32
DNS = 172.32.0.2
MTU = 1280

[Peer]
PublicKey = <server public key>
AllowedIPs = 0.0.0.0/0
Endpoint = <your A_RECORD_NAME>:51820
PersistentKeepalive = 25
```

- **`MTU = 1280`**: matches the server's `/vpn-wireguard/MTU` SSM
  parameter (see [Deployment](#deployment) below) — client and server
  MTU must match. `1280` is a conservative value chosen after path-MTU
  issues caused slow/stalling connections at the previous default of
  `1420`; if your own path tolerates a higher value you can raise both
  ends together, but keep them in sync.
- **`DNS = 172.32.0.2`**: every regional VPC is created with the same
  hardcoded CIDR `172.32.0.0/16` (`lib/vpn-vm-deploy-stack.ts:28`,
  identical across all 7 regions), so `172.32.0.2` — the CIDR's base
  address + 2, i.e. that VPC's Amazon-provided DNS resolver — is the
  same value everywhere. Using it instead of a public resolver (e.g.
  `1.1.1.1`) keeps DNS queries inside AWS's network instead of round
  -tripping out to the public internet and back, which is more resilient
  to internet-path jitter/bufferbloat.

### Getting Your API Key

The API Gateway and Lambda live in the `VPNLambdaDeployStack`, deployed by
the pipeline's `cd-lambda` stage (see `lib/vpn-pipeline-lambda-stage.ts`)
into `eu-west-1`. The API key is stored as an SSM `SecureString`
parameter, not in Secrets Manager.

**Option 1: AWS Console**

1. Go to the AWS Systems Manager console → Parameter Store (region `eu-west-1`)
2. Find the parameter named `/vpn-starter-proxy/api-key`
3. Click "Show" / "Show decrypted value" to reveal it

**Option 2: AWS CLI**

```bash
aws ssm get-parameter --region eu-west-1 \
  --name "/vpn-starter-proxy/api-key" \
  --with-decryption \
  --query "Parameter.Value" --output text
```

**Option 3: CloudFormation Outputs**

The API endpoint and the API key's parameter name are available as
outputs of the `VPNLambdaDeployStack`, not the top-level `VPNPipelineStack`
(the pipeline stack itself has no outputs). Because it's deployed as a CDK
Pipelines stage, first find its full stack name, then query its outputs:

```bash
STACK_NAME=$(aws cloudformation describe-stacks --region eu-west-1 \
  --query "Stacks[?contains(StackName, 'VPNLambdaDeployStack')].StackName" \
  --output text)

aws cloudformation describe-stacks --region eu-west-1 \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='VPNStarterProxyApiEndpoint'].OutputValue" \
  --output text

aws cloudformation describe-stacks --region eu-west-1 \
  --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[?OutputKey=='VPNStarterProxyApiKeyParamName'].OutputValue" \
  --output text
```

---

## Infrastructure Guide

### Architecture Overview

The infrastructure consists of four main components:

#### 1. **VPN VM Infrastructure**

WireGuard VPN instances deployed across multiple AWS regions:

- eu-west-1 (Europe - Ireland)
- eu-west-2 (Europe - London)
- eu-west-3 (Europe - Paris)
- eu-north-1 (Europe - Stockholm)
- us-east-1 (US East - N. Virginia)
- ap-southeast-2 (Asia Pacific - Sydney)
- ca-central-1 (Canada - Central)

#### 2. **VPN Toggle Lambda Function** (Python)

Manages VPN lifecycle operations:

- Starts/stops VPN instances based on demand
- Updates Route53 DNS records for VPN endpoints
- Manages security group rules for IP whitelisting
- Triggered by SNS topics from email or API requests

**Location:** `src/vpn_toggle/`

#### 3. **VPN Idle Shutdown Lambda Function** (Python)

Automatically stops a forgotten VPN instance so it doesn't keep billing:

- Runs on an EventBridge schedule (every 15 minutes)
- Stops a region's VPN if it's been idle (near-zero network traffic) past a grace
  period, or if it's exceeded a hard maximum runtime, whichever comes first
- Sends an email notification (via SNS) whenever it auto-stops a region
- Shares the same code package and dependency layer as the VPN Toggle Lambda

**Location:** `src/vpn_toggle/idle_shutdown.py`

#### 4. **VPN Starter Proxy Lambda Function** (TypeScript)

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
- CloudWatch (read-only, for idle-traffic metrics)
- EventBridge (for the scheduled auto-stop check)

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

4. **Populate SSM Parameter Store:**

   ```sh
   export AWS_REGION=<myregion>
   aws ssm put-parameter --name "/vpn-wireguard/AWS_REGION" --value "us-east-1" --type String
   aws ssm put-parameter --name "/vpn-wireguard/PRIVATE_IP_CIDR" --value "10.0.0.1/32" --type String
   aws ssm put-parameter --name "/vpn-wireguard/PUBLIC_KEY" --value "ssh-rsa xxxxx" --type String
   aws ssm put-parameter --name "/vpn-wireguard/WIREGUARD_IMAGE" --value "wireguard-server-2023-11-21-1150" --type SecureString
   aws ssm put-parameter --name "/vpn-wireguard/ZONE_NAME" --value "acme.com" --type String
   aws ssm put-parameter --name "/vpn-wireguard/RECORD_NAME" --value "vpn.acme.com" --type String
   aws ssm put-parameter --name "/vpn-wireguard/NOTIFICATION_EMAIL" --value "you@example.com" --type String
   ```

   `NOTIFICATION_EMAIL` is where auto-stop alerts (see
   [Cost Optimization](#cost-optimization)) are sent. After the first deploy, AWS sends
   a one-time "Subscription Confirmation" email to this address — click the link in it,
   or no notifications will be delivered.

   The WireGuard server config is rendered at instance boot from these
   parameters in the central region (`eu-west-1`) — the AMI holds no keys:

   ```sh
   # Server's WireGuard private key
   aws ssm put-parameter --region eu-west-1 --name "/vpn-wireguard/SERVER_PRIVATE_KEY" \
     --type SecureString --value "<server-wireguard-private-key>"

   # One line per client device: <device-public-key>,<tunnel-ip/32>
   # Every device gets its OWN key pair and tunnel IP - never share a key
   # between devices (the server flaps between endpoints if you do).
   aws ssm put-parameter --region eu-west-1 --name "/vpn-wireguard/CLIENT_PEERS" \
     --type String --value "$(printf '%s\n' \
       '<device1-public-key>,10.0.0.2/32' \
       '<device2-public-key>,10.0.0.3/32')"

   # Tunnel MTU, used by the server; client configs must use the same value.
   # Optional - the server defaults to 1420 if unset. See the vpn-client repo
   # README for how to probe your path MTU and pick this value.
   aws ssm put-parameter --region eu-west-1 --name "/vpn-wireguard/MTU" \
     --type String --value "1420"
   ```

   > **Migrating from the legacy setup:** the old `/vpn-wireguard/PRIVATE_KEY`
   > parameter (appended verbatim to `wg0.conf` by the previous user-data) is no
   > longer read. Inspect its contents first
   > (`aws ssm get-parameter --name /vpn-wireguard/PRIVATE_KEY --with-decryption`),
   > carry anything still needed over to `SERVER_PRIVATE_KEY`/`CLIENT_PEERS`,
   > then delete it.

   To verify parameters:

   ```sh
   aws ssm get-parameter --name "/vpn-wireguard/AWS_REGION"
   aws ssm get-parameter --name "/vpn-wireguard/PRIVATE_IP_CIDR"
   aws ssm get-parameter --name "/vpn-wireguard/PUBLIC_KEY"
   aws ssm get-parameter --name "/vpn-wireguard/ZONE_NAME"
   aws ssm get-parameter --name "/vpn-wireguard/RECORD_NAME"
   aws ssm get-parameter --name "/vpn-wireguard/WIREGUARD_IMAGE"
   aws ssm get-parameter --name "/vpn-wireguard/NOTIFICATION_EMAIL"
   aws ssm get-parameter --region eu-west-1 --name "/vpn-wireguard/SERVER_PRIVATE_KEY" --with-decryption
   aws ssm get-parameter --region eu-west-1 --name "/vpn-wireguard/CLIENT_PEERS"
   aws ssm get-parameter --region eu-west-1 --name "/vpn-wireguard/MTU"
   ```

5. **Compile the VPN Starter Proxy Lambda:**

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
│   │   ├── idle_shutdown.py          # Idle/max-runtime auto-stop Lambda handler
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
- VPN Idle Shutdown Lambda: `/aws/lambda/VPNIdleShutdownFunction`
- VPN Starter Proxy Lambda: `/aws/lambda/VPNStarterProxyFunction`
- API Gateway: Enabled with full request/response logging

**View logs:**

```bash
# VPN Starter Proxy logs
aws logs tail /aws/lambda/VPNStarterProxyFunction --follow

# VPN Toggle logs
aws logs tail /aws/lambda/VPNToggleFunction --follow

# VPN Idle Shutdown logs (per-region uptime/bytes-transferred decision detail on every
# 15-minute tick - useful when tuning the idle threshold)
aws logs tail /aws/lambda/VPNIdleShutdownFunction --follow
```

An auto-stop email notification is the primary user-facing signal that a region was
stopped; the log group above is where to look for *why* (uptime vs. idle-traffic) if
that's ever unclear.

**CloudWatch Metrics:**

- Lambda invocations, duration, errors
- API Gateway requests, 4xx/5xx errors, latency
- SNS published messages

### Troubleshooting

**API returns 401 Unauthorized:**

- Verify API key is correct
- Check API key is passed in `X-Api-Key` header

**API returns 400 Bad Request:**

- Ensure region is one of: `eu-west-1`, `eu-west-2`, `eu-west-3`, `eu-north-1`, `us-east-1`, `ap-southeast-2`, `ca-central-1`, `none`
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

### Migration from Secrets Manager

If you have existing secrets in AWS Secrets Manager, use the migration script to convert them to SSM parameters:

```sh
cd migration
python3 migrate-secrets-to-parameters.py --region eu-west-1 --all-regions
```

See [migration/README.md](migration/README.md) for detailed migration instructions.

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

- **VPN instances auto-stop themselves.** The VPN Idle Shutdown Lambda
  (`src/vpn_toggle/idle_shutdown.py`) runs on a 15-minute EventBridge schedule and stops
  a region's VPN if either of these is true:
  - it's been idle (near-zero `NetworkIn`+`NetworkOut`, using the free 5-minute
    basic-monitoring datapoints — no detailed monitoring is enabled) for a full
    look-back window, past an initial grace period, **or**
  - it's exceeded a hard maximum runtime, regardless of traffic (the backstop for a
    session that's technically active but simply forgotten).

  You get an email (via the `vpn-auto-stop-notifications` SNS topic —
  see `NOTIFICATION_EMAIL` above) whenever this fires, naming the region and the reason.

  These are tunable via environment variables on `VPNIdleShutdownFunction` in
  `lib/vpn-lambda-deploy-stack.ts` (redeploy required after changing them):

  | Env var | Default |
  |---|---|
  | `MAX_RUNTIME_MINUTES` | `120` (2 hours) |
  | `GRACE_PERIOD_MINUTES` | `15` |
  | `IDLE_WINDOW_MINUTES` | `30` |
  | `IDLE_BYTE_THRESHOLD_BYTES` | `5242880` (5 MB) |

  The evaluation schedule itself (every 15 minutes) is a CDK code constant, not an env
  var — changing the cadence needs a code change, not just a redeploy of env vars.
- Lambda functions only incur costs when invoked
- API Gateway charges per request
- Consider Reserved Instances for always-on VPN instances

### License

This project is private and proprietary.
