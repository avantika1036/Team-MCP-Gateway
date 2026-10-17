import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

import { config } from './config.js';
import type { UpstreamServer } from './registry.js';

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

async function withClient<T>(
  upstream: UpstreamServer,
  operation: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({
    name: 'urumi-mcp-gateway',
    version: '0.1.0',
  });

  const transport = new StreamableHTTPClientTransport(new URL(upstream.url));

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
