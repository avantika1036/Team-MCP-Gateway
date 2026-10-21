# Urumi Demo Runbook and Acceptance Checklist

This checklist separates a feature being present in source from the acceptance behavior actually demonstrated in a running cluster. Record the observed result for every item before claiming it is verified.

## 1. Preflight

- [ ] `npm ci` completes from a clean checkout.
- [ ] `npm run build` passes for every workspace.
- [ ] `npm test` passes.
- [ ] `npm run check` passes.
- [ ] Helm chart rendering/linting completes on the same charts/values intended for the demo.
- [ ] Required Secrets exist in the correct namespaces; no credentials are stored in Git.
- [ ] `kubectl get pods -A` shows all expected platform/store pods ready.
- [ ] Gateway and store URLs are reachable from the browser and the test MCP client.

## 2. Gateway, authentication, and aggregation

- [ ] The gateway's `/mcp` endpoint responds to a valid Streamable HTTP MCP client.
- [ ] A client with no key or an invalid key is rejected.
- [ ] A member key can call tools but receives `403` on admin endpoints.
- [ ] An admin API key can list/create/update/disable/delete upstream definitions.
- [ ] Tool discovery includes tools from WooCommerce, Calculator, and Utility.
- [ ] Namespacing is stable and unambiguous, for example `woocommerce__list_products` and `calculator__mean`.
- [ ] Disabling an upstream removes its tools from the gateway's current tool list; re-enabling restores them after refresh.
- [ ] Scaling one upstream to zero or otherwise stopping it does not prevent calls to healthy upstreams; restore it after the demo.
- [ ] Revoking a key causes its next authenticated request to fail; another valid key continues to work.
- [ ] Audit records identify the expected user/key, upstream/tool, timing/duration, and success/error outcome.

## 3. WooCommerce end-to-end workflow

Use a disposable test product/order and avoid real payment details.

- [ ] `list_products` returns the expected ID, name, price, and status from the original store.
- [ ] `create_product` creates a uniquely named test product in the intended store and returns its product ID.
- [ ] The new product is visible in the WooCommerce admin and on the storefront if published.
- [ ] Complete a real storefront checkout using the configured safe demo payment method and test customer details.
- [ ] `list_orders` returns the newly created order; use an appropriate timezone-aware `after`/`before` interval for “today”.
- [ ] `get_order` returns that exact order ID and expected line items/total/status.
- [ ] `update_order_status` changes only the test order and the new status is returned by a subsequent `get_order`.
- [ ] Audit records correspond to the create/list/get/update calls.

Do not mark the checkout/order scenario done until an order ID has been produced and independently checked.

## 4. Chat-agent workflow

- [ ] Sign in with a database-backed member API key.
- [ ] Ask the agent a read-only question about products and check the displayed tool call/result against WooCommerce.
- [ ] Ask one prompt that requires two different upstreams (for example, a store query plus `calculator__mean`) and verify both calls/results.
- [ ] Ask the agent to create a uniquely named test product in the intended store, then verify in WooCommerce.
- [ ] Query today’s orders and confirm the answer uses tool output rather than invented values.
- [ ] Confirm that failed tool calls are displayed as failures and not described as successes.

## 5. Independent MCP client

Use an external MCP client process, not the chat UI, configured only with the gateway URL and a valid user API key.

- [ ] Discover tools from at least two enabled upstreams.
- [ ] Invoke one safe read-only tool from each of those upstreams.
- [ ] Verify that the external client never needs an upstream URL, upstream credential, or LLM provider key.
- [ ] Repeat with a revoked key and confirm the request fails.

## 6. Multi-store isolation and lifecycle

Use a unique test slug such as `store-two-demo` if `store-two` is already present.

- [ ] Create Store Two through the dashboard/API.
- [ ] Verify a dedicated namespace, WordPress deployment, database deployment, service, PVCs, `store-credentials`, WooCommerce API credentials, ingress, `ResourceQuota`, `LimitRange`, and `NetworkPolicy` resources.
- [ ] Confirm the per-store MCP upstream is auto-registered and its five WooCommerce tools are visible.
- [ ] Create a uniquely named product through Store Two's own `store-<slug>__create_product` tool.
- [ ] List products from the original store and Store Two; demonstrate that the product is only in Store Two.
- [ ] Complete a test checkout in Store Two and retrieve its order using Store Two's `list_orders`/`get_order` tools.
- [ ] Delete Store Two using the control-plane admin flow.
- [ ] Verify its namespace/release and gateway tools are gone, while the original store and Calculator/Utility tools still work.
- [ ] Review the StorageClass reclaim policy when interpreting PVC/PV cleanup.

## 7. Submission artifacts

- [ ] README documents prerequisites, local setup, configuration, commands, endpoints, and known limitations.
- [ ] Architecture diagram/request flow are included.
- [ ] Trade-offs and threat model discuss user keys, provider credentials, provisioner RBAC, tenant isolation, upstream trust, and persistence/deletion.
- [ ] The GitHub branch contains the intended source and docs, with no API keys/passwords or patch-debug artifacts.
- [ ] The final demo has been rehearsed from a fresh terminal with the exact intended image tags and Helm values.

## Evidence log

Record date, cluster/context, image tags, and a short result for each section above. Prefer sanitized command output and screenshots; redact keys, passwords, order/customer PII, and internal tokens.

## Optional upstream credential verification

- [ ] Register a disposable test upstream with a bearer token or custom `X-API-Key` header.
- [ ] Verify the authenticated upstream accepts discovery/calls and returns expected tools.
- [ ] Inspect `/api/admin/servers` and the persisted `servers.json`: they must show only authentication metadata, never the credential value.
- [ ] Inspect the dedicated Kubernetes Secret by metadata/data-key only (do not print or screenshot its value) and verify it exists only in the platform namespace.
- [ ] Update the credential through the edit form and confirm the new value is used; remove authentication and confirm the credential key is deleted.
- [ ] Delete the disposable upstream and verify its credential key is removed without affecting other upstreams.
