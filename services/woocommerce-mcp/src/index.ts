import { createMcpExpressApp } from '@modelcontextprotocol/express';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

import { config } from './config.js';
import { WooCommerceClient, type WooOrder, type WooProduct } from './woocommerce-client.js';

const woo = new WooCommerceClient();

function success(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  };
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : 'An unexpected error occurred.';

  return {
    isError: true,
    content: [{ type: 'text' as const, text: message }],
  };
}

async function safely(operation: () => Promise<unknown>) {
  try {
    return success(await operation());
  } catch (error) {
    return failure(error);
  }
}

function summarizeProduct(product: WooProduct) {
  return {
    id: product.id,
    name: product.name,
    type: product.type,
    status: product.status,
    sku: product.sku,
    price: product.price,
    regular_price: product.regular_price,
    stock_status: product.stock_status,
    permalink: product.permalink,
  };
}

function summarizeOrder(order: WooOrder) {
  return {
    id: order.id,
    status: order.status,
    date_created: order.date_created,
    date_modified: order.date_modified,
    total: order.total,
    currency: order.currency,
    payment_method: order.payment_method,
    customer_note: order.customer_note,
    line_items: (order.line_items ?? []).map((item) => ({
      name: item.name,
      quantity: item.quantity,
      total: item.total,
      sku: item.sku,
    })),
  };
}

const orderStatus = z.enum([
  'pending',
  'processing',
  'on-hold',
  'completed',
  'cancelled',
  'refunded',
  'failed',
]);

function buildMcpServer(): McpServer {
  const server = new McpServer({
    name: 'urumi-woocommerce-mcp',
    version: '0.1.0',
  });

  server.registerTool(
    'list_products',
    {
      title: 'List WooCommerce products',
      description:
        'List products from the connected WooCommerce store, optionally filtering by search text. Results include product IDs and prices.',
      inputSchema: z.object({
        search: z.string().trim().min(1).max(100).optional(),
        page: z.number().int().min(1).max(1000).default(1),
        per_page: z.number().int().min(1).max(100).default(20),
      }),
    },
    async ({ search, page, per_page }) =>
      safely(async () => {
        const products = await woo.request<WooProduct[]>('GET', 'products', {
          search,
          page,
          per_page,
        });

        return {
          page,
          per_page,
          count: products.length,
          products: products.map(summarizeProduct),
        };
      }),
  );

  server.registerTool(
    'create_product',
    {
      title: 'Create a WooCommerce product',
      description:
        'Create a simple product. Set its name and regular price; products are published by default so they can be ordered from the storefront.',
      inputSchema: z.object({
        name: z.string().trim().min(1).max(200),
        regular_price: z
          .string()
          .regex(
            /^\d+(\.\d{1,2})?$/,
            'regular_price must be a non-negative decimal with up to two decimal places',
          ),
        description: z.string().max(5000).optional(),
        sku: z.string().trim().max(100).optional(),
        status: z.enum(['publish', 'draft', 'pending', 'private']).default('publish'),
      }),
    },
    async ({ name, regular_price, description, sku, status }) =>
      safely(async () => {
        const product = await woo.request<WooProduct>(
          'POST',
          'products',
          {},
          {
            name,
            type: 'simple',
            regular_price,
            status,
            ...(description !== undefined ? { description } : {}),
            ...(sku ? { sku } : {}),
          },
        );

        return {
          message: 'Product created successfully.',
          product: summarizeProduct(product),
        };
      }),
  );

  server.registerTool(
    'list_orders',
    {
      title: 'List WooCommerce orders',
      description:
        "List orders with optional ISO 8601 after/before filters and status. Use after and before to retrieve today's orders in a chosen timezone.",
      inputSchema: z.object({
        after: z.string().optional(),
        before: z.string().optional(),
        status: orderStatus.optional(),
        page: z.number().int().min(1).max(1000).default(1),
        per_page: z.number().int().min(1).max(100).default(20),
      }),
    },
    async ({ after, before, status, page, per_page }) =>
      safely(async () => {
        const orders = await woo.request<WooOrder[]>('GET', 'orders', {
          after,
          before,
          status,
          page,
          per_page,
        });

        return {
          page,
          per_page,
          count: orders.length,
          orders: orders.map(summarizeOrder),
        };
      }),
  );

  server.registerTool(
    'get_order',
    {
      title: 'Get a WooCommerce order',
      description: 'Retrieve a specific order by its numeric WooCommerce order ID.',
      inputSchema: z.object({
        order_id: z.number().int().positive(),
      }),
    },
    async ({ order_id }) =>
      safely(async () => {
        const order = await woo.request<WooOrder>('GET', `orders/${order_id}`);

        return { order: summarizeOrder(order) };
      }),
  );

  server.registerTool(
    'update_order_status',
    {
      title: 'Update a WooCommerce order status',
      description:
        "Change an order's status. Use only when the caller is authorized to make order changes.",
      inputSchema: z.object({
        order_id: z.number().int().positive(),
        status: orderStatus,
      }),
    },
    async ({ order_id, status }) =>
      safely(async () => {
        const order = await woo.request<WooOrder>('PUT', `orders/${order_id}`, {}, { status });

        return {
          message: 'Order status updated successfully.',
          order: summarizeOrder(order),
        };
      }),
  );

  return server;
}

const app = createMcpExpressApp({
  host: config.bindHost,
  allowedHosts: config.allowedHosts,
});

app.get('/healthz', (_request, response) => {
  response.status(200).json({
    status: 'ok',
    service: config.serviceName,
  });
});

const mcpHandler = toNodeHandler(createMcpHandler(buildMcpServer));

app.all('/mcp', (request, response) => {
  void mcpHandler(request, response, request.body).catch((error: unknown) => {
    console.error(
      'MCP transport failure:',
      error instanceof Error ? error.message : 'unknown error',
    );

    if (!response.headersSent) {
      response.status(500).json({ error: 'MCP request failed.' });
    }
  });
});

app.listen(config.port, config.bindHost, () => {
  console.info(`${config.serviceName} listening on ${config.bindHost}:${config.port}`);
});
