import { timingSafeEqual } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import express, { type RequestHandler } from 'express';

import { createMcpHandler, fromJsonSchema, McpServer } from '@modelcontextprotocol/server';

import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import * as z from 'zod';

import { config, validateUpstreamUrl } from './config.js';
import { ServerRegistry, type UpstreamServer } from './registry.js';
import { callUpstreamTool, discoverTools, type RemoteTool } from './upstreams.js';

import {
  authenticateApiKey,
  createApiKeyForUser,
  createUserWithApiKey,
  finishAuditEvent,
  initializeDatabase,
  listApiKeys,
  listAuditEvents,
  listUsers,
  revokeApiKey,
  startAuditEvent,
  type AuthenticatedIdentity,
  type UserRole,
} from './database.js';

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
const createUserSchema = z.object({
  email: z.string().trim().email().max(254),
  displayName: z.string().trim().min(1).max(100),
  role: z.enum(['admin', 'member']).default('member'),
  keyName: z.string().trim().min(1).max(100).default('initial'),
});

const createKeySchema = z.object({
  keyName: z.string().trim().min(1).max(100),
});

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');

  return a.length === b.length && timingSafeEqual(a, b);
}

const requireAdmin: RequestHandler = (request, response, next) => {
  const header = request.header('authorization');
  const supplied = header?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (!supplied) {
    response.status(401).json({ error: 'Unauthorized' });
    return;
  }

  if (constantTimeEqual(supplied, config.adminToken)) {
    next();
    return;
  }

  if (!config.databaseUrl) {
    response.status(401).json({ error: 'Unauthorized' });
    return;
  }

  void authenticateApiKey(supplied)
    .then((identity) => {
      if (!identity) {
        response.status(401).json({ error: 'Unauthorized' });
        return;
      }

      if (identity.role !== 'admin') {
        response.status(403).json({ error: 'Administrator role required.' });
        return;
      }

      next();
    })
    .catch((error: unknown) => {
      console.error('Admin authentication failed:', messageOf(error));

      if (!response.headersSent) {
        response.status(503).json({ error: 'Authentication service unavailable.' });
      }
    });
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

const identityStorage = new AsyncLocalStorage<AuthenticatedIdentity>();

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
          const identity = identityStorage.getStore();

          if (!identity) {
            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: 'Authenticated identity context is missing.',
                },
              ],
            };
          }

          let audit: { id: string; startedAtMs: number };

          try {
            audit = await startAuditEvent({
              identity,
              upstreamId: entry.upstream.id,
              toolName: entry.tool.name,
              exposedToolName: entry.exposedName,
            });
          } catch (error) {
            console.error('Could not start audit event:', messageOf(error));

            return {
              isError: true,
              content: [
                {
                  type: 'text' as const,
                  text: 'Audit storage is unavailable; the tool was not executed.',
                },
              ],
            };
          }

          try {
            const result = await callUpstreamTool(
              entry.upstream,
              entry.tool.name,
              args as Record<string, unknown>,
            );

            try {
              await finishAuditEvent({
                id: audit.id,
                startedAtMs: audit.startedAtMs,
                outcome: result.isError ? 'error' : 'success',
              });
            } catch (auditError) {
              console.error('Could not complete audit event:', messageOf(auditError));
            }

            return result;
          } catch (error) {
            try {
              await finishAuditEvent({
                id: audit.id,
                startedAtMs: audit.startedAtMs,
                outcome: 'error',
                errorMessage: messageOf(error),
              });
            } catch (auditError) {
              console.error('Could not complete failed audit event:', messageOf(auditError));
            }

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

app.get('/api/admin/users', requireAdmin, async (_request, response) => {
  if (!config.databaseUrl) {
    response.status(503).json({ error: 'Database is not configured.' });
    return;
  }

  try {
    response.json({ users: await listUsers() });
  } catch (error) {
    console.error('Could not list users:', messageOf(error));
    response.status(500).json({ error: 'Could not list users.' });
  }
});

app.post('/api/admin/users', requireAdmin, async (request, response) => {
  const parsed = createUserSchema.safeParse(request.body);

  if (!parsed.success) {
    response.status(400).json({
      error: 'Invalid user configuration.',
      details: parsed.error.issues,
    });
    return;
  }

  if (!config.databaseUrl) {
    response.status(503).json({ error: 'Database is not configured.' });
    return;
  }

  try {
    const created = await createUserWithApiKey(parsed.data);
    response.status(201).json({
      user: created.user,
      key: created.key,
      apiKey: created.apiKey,
      warning: 'Copy this API key now. Its secret is not stored and cannot be shown again.',
    });
  } catch (error) {
    const code = (error as { code?: string }).code;

    if (code === '23505') {
      response.status(409).json({ error: 'A user with this email already exists.' });
      return;
    }

    console.error('Could not create user:', messageOf(error));
    response.status(500).json({ error: 'Could not create user.' });
  }
});

app.get('/api/admin/users/:id/keys', requireAdmin, async (request, response) => {
  const parsedId = z.string().uuid().safeParse(request.params.id);

  if (!parsedId.success) {
    response.status(400).json({ error: 'Invalid user ID.' });
    return;
  }

  if (!config.databaseUrl) {
    response.status(503).json({ error: 'Database is not configured.' });
    return;
  }

  try {
    response.json({ keys: await listApiKeys(parsedId.data) });
  } catch (error) {
    console.error('Could not list API keys:', messageOf(error));
    response.status(500).json({ error: 'Could not list API keys.' });
  }
});

app.post('/api/admin/users/:id/keys', requireAdmin, async (request, response) => {
  const parsedId = z.string().uuid().safeParse(request.params.id);
  const parsedBody = createKeySchema.safeParse(request.body);

  if (!parsedId.success || !parsedBody.success) {
    response.status(400).json({
      error: 'A valid user ID and keyName are required.',
    });
    return;
  }

  if (!config.databaseUrl) {
    response.status(503).json({ error: 'Database is not configured.' });
    return;
  }

  try {
    const users = await listUsers();

    if (!users.some((user) => user.id === parsedId.data)) {
      response.status(404).json({ error: 'User not found.' });
      return;
    }

    const created = await createApiKeyForUser(parsedId.data, parsedBody.data.keyName);

    response.status(201).json({
      key: created.key,
      apiKey: created.apiKey,
      warning: 'Copy this API key now. Its secret is not stored and cannot be shown again.',
    });
  } catch (error) {
    console.error('Could not create API key:', messageOf(error));
    response.status(500).json({ error: 'Could not create API key.' });
  }
});

app.delete('/api/admin/keys/:id', requireAdmin, async (request, response) => {
  const parsedId = z.string().uuid().safeParse(request.params.id);

  if (!parsedId.success) {
    response.status(400).json({ error: 'Invalid API key ID.' });
    return;
  }

  if (!config.databaseUrl) {
    response.status(503).json({ error: 'Database is not configured.' });
    return;
  }

  try {
    const revoked = await revokeApiKey(parsedId.data);

    if (!revoked) {
      response.status(404).json({ error: 'Active API key not found.' });
      return;
    }

    response.status(204).end();
  } catch (error) {
    console.error('Could not revoke API key:', messageOf(error));
    response.status(500).json({ error: 'Could not revoke API key.' });
  }
});

app.get('/api/admin/audit-events', requireAdmin, async (request, response) => {
  if (!config.databaseUrl) {
    response.status(503).json({ error: 'Database is not configured.' });
    return;
  }

  const limit = Number(request.query.limit ?? '50');
  const rawUserId = request.query.userId;
  const userId = typeof rawUserId === 'string' ? rawUserId : undefined;

  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    response.status(400).json({ error: 'limit must be an integer from 1 to 200.' });
    return;
  }

  if (userId && !z.string().uuid().safeParse(userId).success) {
    response.status(400).json({ error: 'userId must be a valid UUID.' });
    return;
  }

  try {
    response.json({
      events: await listAuditEvents({ limit, ...(userId ? { userId } : {}) }),
    });
  } catch (error) {
    console.error('Could not list audit events:', messageOf(error));
    response.status(500).json({ error: 'Could not list audit events.' });
  }
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

app.all('/mcp', async (request, response) => {
  if (!config.databaseUrl) {
    response.status(503).json({
      error: 'MCP authentication is unavailable because the database is not configured.',
    });
    return;
  }

  const header = request.header('authorization');
  const supplied = header?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (!supplied) {
    response.status(401).json({ error: 'A valid API key is required.' });
    return;
  }

  let identity: AuthenticatedIdentity | null;

  try {
    identity = await authenticateApiKey(supplied);
  } catch (error) {
    console.error('MCP API-key authentication failed:', messageOf(error));

    if (!response.headersSent) {
      response.status(503).json({ error: 'Authentication service unavailable.' });
    }
    return;
  }

  if (!identity) {
    response.status(401).json({ error: 'Invalid, expired, or revoked API key.' });
    return;
  }

  identityStorage.run(identity, () => {
    void mcpHandler(request, response, request.body).catch((error: unknown) => {
      console.error('MCP gateway transport failure:', messageOf(error));

      if (!response.headersSent) {
        response.status(500).json({ error: 'MCP request failed.' });
      }
    });
  });
});

if (config.databaseUrl) {
  await initializeDatabase();
  console.info('Identity and audit database initialized.');
} else {
  console.warn('DATABASE_URL is unset; MCP requests will be rejected.');
}

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
