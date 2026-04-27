export type HttpTraceOperation = "caddy" | "cloudflare" | "dns";

export interface HttpTraceExchange {
  operation: HttpTraceOperation;
  request: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    body?: string;
  };
  response?: {
    statusCode: number;
    statusText?: string;
    headers?: Record<string, string>;
    body?: string;
  };
  transport?: string;
  error?: string;
}

export type HttpTraceLogger = (exchange: HttpTraceExchange) => Promise<void> | void;

export function redactHttpHeaders(
  headers: Record<string, string | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([, value]) => typeof value === "string" && value.length > 0)
      .map(([name, value]) => [
        name,
        name.toLowerCase() === "authorization" ? "<redacted>" : (value as string),
      ]),
  );
}

export function formatHttpTraceBody(body: unknown): string | undefined {
  if (body === undefined) {
    return undefined;
  }

  if (typeof body === "string") {
    return body;
  }

  return JSON.stringify(body, null, 2);
}

export function responseHeadersToRecord(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries());
}
