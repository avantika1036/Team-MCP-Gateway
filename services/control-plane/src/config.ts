import { isIP } from 'node:net';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set.`);
  }
  return value;
}

function csvEnv(name: string, fallback: string): string[] {
  return (process.env[name] ?? fallback)
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

const port = Number(process.env.PORT ?? '4000');
const requestTimeoutMs = Number(process.env.UPSTREAM_TIMEOUT_MS ?? '5000');
const llmTimeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? '45000');

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be a valid TCP port.');
}

if (!Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1000 || requestTimeoutMs > 60000) {
  throw new Error('UPSTREAM_TIMEOUT_MS must be between 1000 and 60000.');
}

if (!Number.isInteger(llmTimeoutMs) || llmTimeoutMs < 1000 || llmTimeoutMs > 120000) {
  throw new Error('LLM_TIMEOUT_MS must be between 1000 and 120000.');
}

export const config = {
  serviceName: 'urumi-mcp-gateway',
  bindHost: process.env.MCP_HOST ?? '127.0.0.1',
  port,
  adminToken: requiredEnv('GATEWAY_ADMIN_TOKEN'),
  databaseUrl: process.env.DATABASE_URL?.trim() ?? '',
  llmApiKey: process.env.LLM_API_KEY?.trim() ?? '',
  llmBaseUrl: (process.env.LLM_BASE_URL ?? 'https://api.openai.com/v1').trim(),
  llmModel: (process.env.LLM_MODEL ?? 'gpt-4o-mini').trim(),
  llmTimeoutMs,
  requestTimeoutMs,
  registryFile: process.env.REGISTRY_FILE ?? './data/servers.json',
  allowedHosts: csvEnv('MCP_ALLOWED_HOSTS', 'localhost,127.0.0.1,[::1]'),
  allowedUpstreamSuffixes: csvEnv(
    'MCP_ALLOWED_UPSTREAM_HOSTS',
    '.svc,.svc.cluster.local,localhost,127.0.0.1,::1',
  ),
};

export function validateUpstreamUrl(value: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error('Upstream URL must be a valid absolute URL.');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP and HTTPS upstreams are allowed.');
  }

  if (url.username || url.password || url.search || url.hash || url.pathname !== '/mcp') {
    throw new Error(
      'Upstream URL must end in /mcp and contain no credentials, query, or fragment.',
    );
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const ipVersion = isIP(hostname);

  if (ipVersion !== 0 && hostname !== '127.0.0.1' && hostname !== '::1') {
    throw new Error(
      'Arbitrary IP-address upstreams are blocked. Use an approved service hostname.',
    );
  }

  const allowed = config.allowedUpstreamSuffixes.some((entry) => {
    if (entry.startsWith('.')) {
      return hostname.endsWith(entry);
    }
    return hostname === entry;
  });

  if (!allowed) {
    throw new Error(
      'Upstream hostname is not allowed. Configure MCP_ALLOWED_UPSTREAM_HOSTS to approve it.',
    );
  }

  return url.toString();
}
