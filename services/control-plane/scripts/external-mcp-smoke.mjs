import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const endpoint = process.env.URUMI_MCP_URL?.trim();
const apiKey = process.env.URUMI_MCP_API_KEY?.trim();

if (!endpoint || !apiKey) {
  console.error('Set URUMI_MCP_URL and URUMI_MCP_API_KEY before running this client.');
  process.exitCode = 2;
} else {
  let transport;
  const client = new Client({ name: 'urumi-external-mcp-smoke', version: '1.0.0' });
  try {
    transport = new StreamableHTTPClientTransport(new URL(endpoint), {
      authProvider: { token: async () => apiKey },
    });
    await client.connect(transport);

    const { tools } = await client.listTools();
    console.log(`Connected to ${endpoint}`);
    console.log(`Discovered ${tools.length} tools:`);
    for (const tool of tools) console.log(`  ${tool.name}`);

    const [toolName, argsText] = process.argv.slice(2);
    if (toolName) {
      const selected = tools.find((tool) => tool.name === toolName);
      if (!selected) {
        throw new Error(`Tool '${toolName}' was not returned by this gateway connection.`);
      }

      let args = {};
      if (argsText) {
        args = JSON.parse(argsText);
        if (!args || typeof args !== 'object' || Array.isArray(args)) {
          throw new Error('Tool arguments must be a JSON object.');
        }
      }

      const result = await client.callTool({ name: toolName, arguments: args });
      console.log(`\nResult from ${toolName}:`);
      console.log(JSON.stringify(result, null, 2));
      if (result.isError) process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'MCP client smoke test failed.');
    process.exitCode = 1;
  } finally {
    await client.close().catch(() => undefined);
    await transport?.close?.().catch(() => undefined);
  }
}
