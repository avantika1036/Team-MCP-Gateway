import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';

import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

function makeUpstream(expectedHeader) {
  const app = createMcpExpressApp({ host: '127.0.0.1', allowedHosts: ['127.0.0.1', 'localhost'] });
  app.use(express.json({ limit: '64kb' }));
  const serverFactory = () => {
    const mcp = new McpServer({ name: 'credential-test-upstream', version: '1.0.0' });
    mcp.registerTool('ping', { description: 'Returns pong.', inputSchema: {} }, async () => ({
      content: [{ type: 'text', text: 'pong' }],
    }));
    return mcp;
  };
  const mcpHandler = toNodeHandler(createMcpHandler(serverFactory));
  app.all('/mcp', (request, response) => {
    const name = Object.keys(expectedHeader)[0];
    if (request.headers[name.toLowerCase()] !== expectedHeader[name]) {
      response.status(401).json({ error: 'Missing upstream credential.' });
      return;
    }
    void mcpHandler(request, response, request.body).catch(() => {
      if (!response.headersSent) response.status(500).json({ error: 'MCP test server failed.' });
    });
  });
  const server = app.listen(0, '127.0.0.1');
  return new Promise((resolve, reject) => {
    server.once('listening', () => resolve({ server, port: server.address().port }));
    server.once('error', reject);
  });
}

test('MCP discovery and calls send server-side bearer and custom-header credentials', async () => {
  const previous = {
    adminToken: process.env.GATEWAY_ADMIN_TOKEN,
    provisionerUrl: process.env.PROVISIONER_URL,
    provisionerToken: process.env.PROVISIONER_INTERNAL_TOKEN,
    timeout: process.env.UPSTREAM_TIMEOUT_MS,
  };
  const credentials = new Map([
    ['bearer-test', 'bearer-secret-value'],
    ['header-test', 'custom-secret-value'],
  ]);
  const provisioner = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.headers.authorization !== 'Bearer internal-test-token') {
      response.writeHead(401, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'Unauthorized.' }));
      return;
    }
    const id = url.pathname.split('/').at(-1);
    const credential = credentials.get(id);
    if (!credential) {
      response.writeHead(404, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: 'Not found.' }));
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ credential }));
  });

  const provisionerPort = await listen(provisioner);
  const bearerUpstream = await makeUpstream({ Authorization: 'Bearer bearer-secret-value' });
  const headerUpstream = await makeUpstream({ 'X-API-Key': 'custom-secret-value' });

  process.env.GATEWAY_ADMIN_TOKEN = 'test-admin-token';
  process.env.PROVISIONER_URL = `http://127.0.0.1:${provisionerPort}`;
  process.env.PROVISIONER_INTERNAL_TOKEN = 'internal-test-token';
  process.env.UPSTREAM_TIMEOUT_MS = '5000';

  try {
    const { discoverTools, callUpstreamTool } = await import('../dist/upstreams.js');
    const testUpstreams = [
      {
        id: 'bearer-test',
        name: 'Bearer test upstream',
        url: `http://127.0.0.1:${bearerUpstream.port}/mcp`,
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        auth: { type: 'bearer' },
      },
      {
        id: 'header-test',
        name: 'Custom-header test upstream',
        url: `http://127.0.0.1:${headerUpstream.port}/mcp`,
        enabled: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        auth: { type: 'header', headerName: 'X-API-Key' },
      },
    ];

    for (const upstream of testUpstreams) {
      const tools = await discoverTools(upstream);
      assert.equal(
        tools.some((tool) => tool.name === 'ping'),
        true,
      );
      const result = await callUpstreamTool(upstream, 'ping', {});
      assert.equal(result.isError, undefined);
      assert.equal(result.content[0].text, 'pong');
    }
  } finally {
    for (const [key, value] of Object.entries({
      GATEWAY_ADMIN_TOKEN: previous.adminToken,
      PROVISIONER_URL: previous.provisionerUrl,
      PROVISIONER_INTERNAL_TOKEN: previous.provisionerToken,
      UPSTREAM_TIMEOUT_MS: previous.timeout,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await Promise.all([
      close(bearerUpstream.server),
      close(headerUpstream.server),
      close(provisioner),
    ]);
  }
});
