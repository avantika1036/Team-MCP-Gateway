import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { isIP } from 'node:net';
import * as z from 'zod';

const port = Number(process.env.PORT ?? '4001');
const host = process.env.MCP_HOST ?? '127.0.0.1';
const allowedHosts = (process.env.MCP_ALLOWED_HOSTS ?? 'localhost,127.0.0.1,[::1]')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

function buildMcpServer(): McpServer {
  const server = new McpServer({
    name: 'urumi-calculator-mcp',
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

  const numberSchema = z.number().finite().min(-1e12).max(1e12);

  server.registerTool(
    'calculate',
    {
      title: 'Calculate',
      description: 'Perform validated arithmetic: add, subtract, multiply, divide, or modulo.',
      inputSchema: z.object({
        operation: z.enum(['add', 'subtract', 'multiply', 'divide', 'modulo']),
        left: numberSchema,
        right: numberSchema,
      }),
    },
    async ({ operation, left, right }) => {
      if ((operation === 'divide' || operation === 'modulo') && right === 0) {
        return errorResult('The right operand cannot be zero for this operation.');
      }

      let value: number;

      switch (operation) {
        case 'add':
          value = left + right;
          break;
        case 'subtract':
          value = left - right;
          break;
        case 'multiply':
          value = left * right;
          break;
        case 'divide':
          value = left / right;
          break;
        case 'modulo':
          value = left % right;
          break;
      }

      if (!Number.isFinite(value)) {
        return errorResult('The result is outside the supported numeric range.');
      }

      return result({
        operation,
        left,
        right,
        result: Number(value.toPrecision(12)),
      });
    },
  );

  server.registerTool(
    'mean',
    {
      title: 'Calculate mean',
      description: 'Calculate the arithmetic mean of a non-empty list of numbers.',
      inputSchema: z.object({
        values: z.array(numberSchema).min(1).max(1000),
      }),
    },
    async ({ values }) => {
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;

      if (!Number.isFinite(mean)) {
        return errorResult('The mean is outside the supported numeric range.');
      }

      return result({ count: values.length, mean });
    },
  );

  return server;
}

const app = createMcpExpressApp({ host, allowedHosts });

app.get('/healthz', (_request, response) => {
  response.json({ status: 'ok', service: 'urumi-calculator-mcp' });
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
  console.info(`urumi-calculator-mcp listening on ${host}:${port}`);
});
