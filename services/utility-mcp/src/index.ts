import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { randomUUID } from 'node:crypto';
import * as z from 'zod';

const port = Number(process.env.PORT ?? '4002');
const host = process.env.MCP_HOST ?? '127.0.0.1';
const allowedHosts = (process.env.MCP_ALLOWED_HOSTS ?? 'localhost,127.0.0.1,[::1]')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

function buildMcpServer(): McpServer {
  const server = new McpServer({
    name: 'urumi-utility-mcp',
    version: '0.1.0',
  });

  function result(data: unknown) {
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  }

  function errorResult(message: string) {
    return {
      isError: true,
      content: [{ type: 'text' as const, text: message }],
    };
  }

  server.registerTool(
    'get_current_time',
    {
      title: 'Get current time',
      description:
        'Return the current instant in UTC and local clock components for a specified IANA time zone.',
      inputSchema: z.object({
        timezone: z.string().trim().min(1).max(100).default('UTC'),
      }),
    },
    async ({ timezone }) => {
      const now = new Date();

      try {
        const formatter = new Intl.DateTimeFormat('en-GB', {
          timeZone: timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hourCycle: 'h23',
        });

        const parts = Object.fromEntries(
          formatter
            .formatToParts(now)
            .filter((part) => part.type !== 'literal')
            .map((part) => [part.type, part.value]),
        );

        return result({
          utc: now.toISOString(),
          timezone,
          localDateTime:
            `${parts.year}-${parts.month}-${parts.day}` +
            `T${parts.hour}:${parts.minute}:${parts.second}`,
        });
      } catch {
        return errorResult(`Invalid or unsupported IANA time zone: ${timezone}`);
      }
    },
  );

  server.registerTool(
    'generate_uuid',
    {
      title: 'Generate UUIDs',
      description: 'Generate one or more random UUID v4 identifiers.',
      inputSchema: z.object({
        count: z.number().int().min(1).max(10).default(1),
      }),
    },
    async ({ count }) => {
      return result({
        count,
        uuids: Array.from({ length: count }, () => randomUUID()),
      });
    },
  );

  return server;
}

const app = createMcpExpressApp({ host, allowedHosts });

app.get('/healthz', (_request, response) => {
  response.json({ status: 'ok', service: 'urumi-utility-mcp' });
});

const handler = toNodeHandler(createMcpHandler(buildMcpServer));

app.all('/mcp', (request, response) => {
  void handler(request, response, request.body).catch(() => {
    if (!response.headersSent) {
      response.status(500).json({ error: 'MCP request failed.' });
    }
  });
});

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be a valid TCP port.');
}

app.listen(port, host, () => {
  console.info(`urumi-utility-mcp listening on ${host}:${port}`);
});
