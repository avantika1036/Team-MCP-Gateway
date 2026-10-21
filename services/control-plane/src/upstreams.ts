import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

import { config } from './config.js';
import type { UpstreamServer } from './registry.js';
import { buildCredentialHeaders, credentialKeyForUpstream } from './upstream-auth.js';

export type RemoteTool = Awaited<ReturnType<Client['listTools']>>['tools'][number];

async function withTimeout<T>(operation: Promise<T>, description: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const timeout = new Promise<T>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${description} timed out.`)),
        config.requestTimeoutMs,
      );
    });

    return await Promise.race([operation, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function credentialHeaders(upstream: UpstreamServer): Promise<Record<string, string> | null> {
  if (!upstream.auth) return null;
  if (!config.provisionerUrl || !config.provisionerToken) {
    throw new Error('The server-side upstream credential store is not configured.');
  }

  // Validate before contacting the credential service; the raw credential is not
  // persisted in the gateway registry or returned by the admin API.
  credentialKeyForUpstream(upstream.id);
  const response = await fetch(
    `${config.provisionerUrl}/upstream-credentials/${encodeURIComponent(upstream.id)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.provisionerToken}`,
        Accept: 'application/json',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    },
  );

  if (response.status === 404) {
    throw new Error(`Credential for upstream '${upstream.id}' is missing.`);
  }
  if (!response.ok) {
    throw new Error(`Could not retrieve credential for upstream '${upstream.id}'.`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Credential store returned an invalid response for '${upstream.id}'.`);
  }
  if (
    !payload ||
    typeof payload !== 'object' ||
    !('credential' in payload) ||
    typeof payload.credential !== 'string'
  ) {
    throw new Error(`Credential store returned an invalid response for '${upstream.id}'.`);
  }

  return buildCredentialHeaders(upstream.auth, payload.credential);
}

async function withClient<T>(
  upstream: UpstreamServer,
  operation: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({
    name: 'urumi-mcp-gateway',
    version: '0.1.0',
  });

  const headers = await credentialHeaders(upstream);
  const transport = new StreamableHTTPClientTransport(
    new URL(upstream.url),
    headers
      ? {
          requestInit: { headers, redirect: 'error' },
        }
      : undefined,
  );

  try {
    await withTimeout(client.connect(transport), `Connecting to upstream '${upstream.id}'`);

    return await operation(client);
  } finally {
    try {
      await client.close();
    } catch {
      // Closing an upstream that timed out or disconnected is best effort.
    }
  }
}

export async function discoverTools(upstream: UpstreamServer): Promise<RemoteTool[]> {
  return withClient(upstream, async (client) => {
    const result = await withTimeout(client.listTools(), `Discovering tools from '${upstream.id}'`);

    return result.tools;
  });
}

export async function callUpstreamTool(
  upstream: UpstreamServer,
  toolName: string,
  args: Record<string, unknown>,
) {
  return withClient(upstream, (client) =>
    withTimeout(
      client.callTool({
        name: toolName,
        arguments: args,
      }),
      `Calling '${upstream.id}__${toolName}'`,
    ),
  );
}
