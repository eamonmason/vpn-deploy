import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';

const TOPIC_ARN = process.env.TOPIC_ARN;
const ALLOWED_API_KEY = process.env.API_KEY;
const ALLOWED_REGIONS = ['eu-west-2', 'us-east-1', 'eu-north-1'];

interface VPNRequest {
  apiKey?: string;
  region: string;
  whitelist_ip: string;
}

const createResponse = (
  statusCode: number,
  body: Record<string, unknown>
): APIGatewayProxyResult => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
  },
  body: JSON.stringify(body),
});

const validateIPAddress = (ip: string): boolean => {
  // Validate IPv4 format
  const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

  // Validate IPv6 format (simplified)
  const ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;

  return ipv4Regex.test(ip) || ipv6Regex.test(ip);
};

const sanitizeInput = (input: string): string => {
  // Remove any potentially malicious characters
  // Note: hyphen must be escaped or at start/end of character class
  return input.replace(/[^\w\s.\-:]/g, '').trim();
};

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return createResponse(200, { message: 'OK' });
  }

  try {
    // Validate required environment variables
    if (!TOPIC_ARN) {
      console.error('TOPIC_ARN environment variable not set');
      return createResponse(500, { error: 'Server configuration error' });
    }

    // Parse request body
    let body: VPNRequest;
    try {
      body = event.body
        ? JSON.parse(event.body)
        : (event as unknown as VPNRequest);
    } catch (parseError) {
      console.error('Invalid JSON in request body:', parseError);
      return createResponse(400, { error: 'Invalid JSON in request body' });
    }

    // API key validation
    if (ALLOWED_API_KEY) {
      const providedKey = body.apiKey || event.headers['X-Api-Key'] || event.headers['x-api-key'];
      if (providedKey !== ALLOWED_API_KEY) {
        console.warn('Unauthorized access attempt');
        return createResponse(401, { error: 'Unauthorized' });
      }
    }

    // Validate required fields
    if (!body.region) {
      return createResponse(400, { error: 'Region is required' });
    }

    if (!body.whitelist_ip) {
      return createResponse(400, { error: 'whitelist_ip is required' });
    }

    // Sanitize and validate region
    const sanitizedRegion = sanitizeInput(body.region);
    if (!ALLOWED_REGIONS.includes(sanitizedRegion)) {
      return createResponse(400, {
        error: `Invalid region. Allowed regions: ${ALLOWED_REGIONS.join(', ')}`,
      });
    }

    // Validate IP address format
    const sanitizedIP = sanitizeInput(body.whitelist_ip);
    if (!validateIPAddress(sanitizedIP)) {
      return createResponse(400, { error: 'Invalid IP address format' });
    }

    // Create SNS client
    const snsClient = new SNSClient({
      region: process.env.AWS_REGION || 'eu-west-1',
    });

    // Prepare message
    const message = {
      region: sanitizedRegion,
      whitelist_ip: sanitizedIP,
    };

    // Publish to SNS
    const command = new PublishCommand({
      TopicArn: TOPIC_ARN,
      Message: JSON.stringify(message),
      MessageAttributes: {
        source: {
          DataType: 'String',
          StringValue: 'iOS',
        },
        region: {
          DataType: 'String',
          StringValue: sanitizedRegion,
        },
      },
    });

    const result = await snsClient.send(command);

    console.log('Published to SNS:', result.MessageId);

    return createResponse(200, {
      success: true,
      messageId: result.MessageId,
      message: 'VPN start message sent successfully',
      region: sanitizedRegion,
      ip: sanitizedIP,
    });
  } catch (error) {
    console.error('Error:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error occurred';
    return createResponse(500, {
      success: false,
      error: errorMessage,
    });
  }
};
