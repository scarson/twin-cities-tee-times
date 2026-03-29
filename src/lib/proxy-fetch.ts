// ABOUTME: SigV4-signed fetch helper that routes requests through the Lambda proxy.
// ABOUTME: Signs requests with aws4fetch, deserializes proxy responses, handles errors.
import { AwsClient } from "aws4fetch";

export interface ProxyRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface ProxyConfig {
  proxyUrl: string;
  accessKeyId: string;
  secretAccessKey: string;
}

export interface ProxyResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export async function proxyFetch(
  request: ProxyRequest,
  config: ProxyConfig
): Promise<ProxyResponse> {
  const aws = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "lambda",
    region: "us-west-2",
  });

  const payload: Record<string, unknown> = {
    url: request.url,
    method: request.method,
    headers: request.headers,
  };
  if (request.body !== undefined) {
    payload.body = request.body;
  }

  const response = await aws.fetch(config.proxyUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12000),
  });

  const data = (await response.json().catch(() => null)) as
    | (ProxyResponse & { proxyError?: boolean; message?: string })
    | null;

  if (data?.proxyError) {
    throw new Error(`Proxy: ${data.message}`);
  }

  if (!response.ok) {
    throw new Error(`Proxy HTTP ${response.status}`);
  }

  if (!data) {
    throw new Error("Proxy returned unparseable response");
  }

  return { status: data.status, headers: data.headers, body: data.body };
}
