import { timingSafeEqual } from 'node:crypto';
import express, { type RequestHandler } from 'express';

import { createMcpHandler, fromJsonSchema, McpServer } from '@modelcontextprotocol/server';

import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import * as z from 'zod';

import { config, validateUpstreamUrl } from './config.js';
import { ServerRegistry, type UpstreamServer } from './registry.js';
import { callUpstreamTool, discoverTools, type RemoteTool } from './upstreams.js';

interface ToolEntry {
  exposedName: string;
  upstream: UpstreamServer;
  tool: RemoteTool;
}

interface RuntimeStatus {
  reachable: boolean;
  toolCount: number;
  lastCheckedAt: string | null;
  lastError?: string;
}

const createServerSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]{1,31}$/),
  name: z.string().trim().min(1).max(100),
  url: z.string().url(),
  enabled: z.boolean().optional().default(true),
});

const updateServerSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    url: z.string().url().optional(),
    enabled: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field must be supplied.',
  });

const enabledSchema = z.object({
  enabled: z.boolean(),
});

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');

  return a.length === b.length && timingSafeEqual(a, b);
}

const requireAdmin: RequestHandler = (request, response, next) => {
  const header = request.header('authorization');
  const supplied = header?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (!supplied || !constantTimeEqual(supplied, config.adminToken)) {
    response.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

const registry = await ServerRegistry.open(config.registryFile);
const runtimeStatus = new Map<string, RuntimeStatus>();

let toolSnapshot: ToolEntry[] = [];
let refreshInFlight: Promise<void> | null = null;

async function refreshToolSnapshot(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;

  const currentRefresh = (async () => {
    const servers = await registry.list();

    const groups = await Promise.all(
      servers.map(async (upstream) => {
        const checkedAt = new Date().toISOString();

        if (!upstream.enabled) {
          runtimeStatus.set(upstream.id, {
            reachable: false,
            toolCount: 0,
            lastCheckedAt: checkedAt,
            lastError: 'Upstream is disabled.',
          });
          return [] as ToolEntry[];
        }

        try {
          const tools = await discoverTools(upstream);

          runtimeStatus.set(upstream.id, {
            reachable: true,
            toolCount: tools.length,
            lastCheckedAt: checkedAt,
          });

          return tools.map((tool) => ({
            exposedName: `${upstream.id}__${tool.name}`,
            upstream,
            tool,
          }));
        } catch (error) {
          runtimeStatus.set(upstream.id, {
            reachable: false,
            toolCount: 0,
            lastCheckedAt: checkedAt,
            lastError: messageOf(error),
          });

          // A failed upstream is isolated; other upstreams remain available.
          return [] as ToolEntry[];
        }
      }),
    );

    toolSnapshot = groups.flat();
  })();

  refreshInFlight = currentRefresh;

  try {
    await currentRefresh;
  } finally {
    if (refreshInFlight === currentRefresh) {
      refreshInFlight = null;
    }
  }
}

function serverWithStatus(server: UpstreamServer) {
  return {
    ...server,
    status: runtimeStatus.get(server.id) ?? {
      reachable: false,
      toolCount: 0,
      lastCheckedAt: null,
      lastError: 'Not checked yet.',
    },
  };
}

function buildGatewayMcpServer(): McpServer {
  const server = new McpServer({
    name: config.serviceName,
    version: '0.1.0',
  });

  for (const entry of toolSnapshot) {
    try {
      const inputSchema = fromJsonSchema(
        entry.tool.inputSchema as Parameters<typeof fromJsonSchema>[0],
      );

      server.registerTool(
        entry.exposedName,
        {
          title: entry.tool.title ?? `${entry.upstream.name}: ${entry.tool.name}`,
          description: `[${entry.upstream.id}] ${entry.tool.description ?? 'No description provided by upstream.'}`,
          inputSchema,
        },
        async (args) => {
          try {
            return await callUpstreamTool(
              entry.upstream,
              entry.tool.name,
              args as Record<string, unknown>,
            );
          } catch (error) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text:
                    `Upstream '${entry.upstream.id}' failed for tool ` +
                    `'${entry.tool.name}': ${messageOf(error)}`,
                },
              ],
            };
          }
        },
      );
    } catch (error) {
      console.error(`Could not register upstream tool '${entry.exposedName}':`, messageOf(error));
    }
  }

  return server;
}

const app = createMcpExpressApp({
  host: config.bindHost,
  allowedHosts: config.allowedHosts,
});

app.use(express.json({ limit: '64kb' }));

app.get('/healthz', (_request, response) => {
  response.status(200).json({
    status: 'ok',
    service: config.serviceName,
  });
});

app.get('/api/admin/servers', requireAdmin, async (_request, response) => {
  const servers = await registry.list();
  response.json({ servers: servers.map(serverWithStatus) });
});

app.post('/api/admin/servers', requireAdmin, async (request, response) => {
  const parsed = createServerSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({
      error: 'Invalid upstream configuration.',
      details: parsed.error.issues,
    });
    return;
  }

  let url: string;

  try {
    url = validateUpstreamUrl(parsed.data.url);
  } catch (error) {
    response.status(400).json({ error: messageOf(error) });
    return;
  }

  try {
    const created = await registry.add({
      ...parsed.data,
      url,
      enabled: parsed.data.enabled ?? true,
    });

    await refreshToolSnapshot();

    response.status(201).json({
      server: serverWithStatus(created),
    });
  } catch (error) {
    response.status(409).json({ error: messageOf(error) });
  }
});

app.put('/api/admin/servers/:id', requireAdmin, async (request, response) => {
  const parsed = updateServerSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({
      error: 'Invalid update.',
      details: parsed.error.issues,
    });
    return;
  }

  const patch = { ...parsed.data };

  if (patch.url !== undefined) {
    try {
      patch.url = validateUpstreamUrl(patch.url);
    } catch (error) {
      response.status(400).json({ error: messageOf(error) });
      return;
    }
  }

  const updated = await registry.update(String(request.params.id), patch);

  if (!updated) {
    response.status(404).json({ error: 'Upstream not found.' });
    return;
  }

  await refreshToolSnapshot();

  response.json({ server: serverWithStatus(updated) });
});

app.patch('/api/admin/servers/:id/enabled', requireAdmin, async (request, response) => {
  const parsed = enabledSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({
      error: 'Body must contain an enabled boolean.',
    });
    return;
  }

  const updated = await registry.update(String(request.params.id), parsed.data);

  if (!updated) {
    response.status(404).json({ error: 'Upstream not found.' });
    return;
  }

  await refreshToolSnapshot();

  response.json({ server: serverWithStatus(updated) });
});

app.delete('/api/admin/servers/:id', requireAdmin, async (request, response) => {
  const id = String(request.params.id);
  const removed = await registry.remove(id);

  if (!removed) {
    response.status(404).json({ error: 'Upstream not found.' });
    return;
  }

  runtimeStatus.delete(id);
  await refreshToolSnapshot();

  response.status(204).end();
});

app.post('/api/admin/servers/:id/refresh', requireAdmin, async (request, response) => {
  const id = String(request.params.id);
  const servers = await registry.list();

  if (!servers.some((server) => server.id === id)) {
    response.status(404).json({ error: 'Upstream not found.' });
    return;
  }

  await refreshToolSnapshot();

  const status = runtimeStatus.get(id);
  response.json({ id, status: status ?? null });
});

const mcpHandler = toNodeHandler(createMcpHandler(() => buildGatewayMcpServer()));

app.all('/mcp', (request, response) => {
  void mcpHandler(request, response, request.body).catch((error: unknown) => {
    console.error('MCP gateway transport failure:', messageOf(error));

    if (!response.headersSent) {
      response.status(500).json({ error: 'MCP request failed.' });
    }
  });
});

await refreshToolSnapshot();

const refreshTimer = setInterval(() => {
  void refreshToolSnapshot().catch((error: unknown) => {
    console.error('Tool snapshot refresh failed:', messageOf(error));
  });
}, 30000);

refreshTimer.unref();

app.listen(config.port, config.bindHost, () => {
  console.info(`${config.serviceName} listening on ${config.bindHost}:${config.port}`);
});
