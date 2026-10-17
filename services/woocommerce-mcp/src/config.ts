function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set.`);
  }
  return value;
}

function parseStoreOrigin(rawUrl: string, name: string): URL {
  const url = new URL(rawUrl);

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${name} must use HTTP or HTTPS.`);
  }

  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error(`${name} must be an origin without credentials, path, query, or fragment.`);
  }

  return url;
}

const parsedStoreUrl = parseStoreOrigin(requiredEnv('WOOCOMMERCE_URL'), 'WOOCOMMERCE_URL');

const parsedTransportUrl = parseStoreOrigin(
  process.env.WOOCOMMERCE_TRANSPORT_URL?.trim() || parsedStoreUrl.origin,
  'WOOCOMMERCE_TRANSPORT_URL',
);

const port = Number(process.env.PORT ?? '3002');
const requestTimeoutMs = Number(process.env.REQUEST_TIMEOUT_MS ?? '10000');

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be a valid TCP port.');
}

if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1000 || requestTimeoutMs > 60000) {
  throw new Error('REQUEST_TIMEOUT_MS must be between 1000 and 60000.');
}

export const config = {
  serviceName: 'urumi-woocommerce-mcp',
  bindHost: process.env.MCP_HOST ?? '127.0.0.1',
  port,
  requestTimeoutMs,
  allowedHosts: (process.env.MCP_ALLOWED_HOSTS ?? 'localhost,127.0.0.1,[::1]')
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean),
  storeUrl: parsedStoreUrl.origin,
  consumerKey: requiredEnv('WOOCOMMERCE_CONSUMER_KEY'),
  consumerSecret: requiredEnv('WOOCOMMERCE_CONSUMER_SECRET'),
  apiBaseUrl: `${parsedTransportUrl.origin}/wp-json/wc/v3`,
};
