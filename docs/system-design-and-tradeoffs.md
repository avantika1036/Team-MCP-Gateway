# System Design and Tradeoffs

## Architecture Choices

### MCP Gateway Pattern
The gateway acts as a centralized aggregation point for multiple upstream MCP servers. This design was chosen over:
- **Direct client-to-upstream connections**: Would require each client to manage multiple upstream URLs, credentials, and authentication schemes
- **Sidecar pattern**: Would require per-application deployment complexity and doesn't support shared team access

**Tradeoff**: Gateway becomes a single point of failure, mitigated by Kubernetes deployment with health checks and the ability to scale horizontally.

### Streamable HTTP Transport
All MCP communication uses Streamable HTTP (via `@modelcontextprotocol/express`) rather than:
- **WebSocket**: Would add connection state management complexity
- **SSE**: Similar complexity with less widespread tooling support

**Tradeoff**: HTTP requires per-request authentication but simplifies deployment behind standard ingress controllers and load balancers.

### Tool Name Prefixing
Tools are exposed as `<upstream-id>__<tool-name>` to prevent collisions when multiple upstreams define tools with the same name.

**Tradeoff**: Longer tool names, but eliminates ambiguity without requiring upstream coordination or renaming.

## Tool Aggregation, Routing, and Failure Handling

### Aggregation
The gateway periodically discovers tools from all enabled upstreams via the `tools/list` MCP method. Results are cached in memory and refreshed on:
- Upstream configuration changes (add/update/delete/enable/disable)
- Manual refresh via admin API
- Periodic health checks

**Tradeoff**: In-memory caching means tool changes aren't instantly visible, but reduces upstream load and improves response times.

### Routing
Tool calls are routed based on the parsed upstream ID from the prefixed tool name. The gateway:
1. Validates the upstream exists and is enabled
2. Creates a fresh MCP client connection for each call
3. Applies upstream authentication headers from the credential store
4. Executes the call with a configurable timeout
5. Closes the client connection

**Tradeoff**: Per-call client creation adds overhead but prevents connection pooling issues and credential leakage between calls.

### Failure Handling
- **Timeouts**: All upstream operations wrapped in `withTimeout()` (default 5s)
- **Dead upstream isolation**: Failed upstreams return empty tool lists; other upstreams remain available
- **Error propagation**: Upstream errors are returned with context (upstream ID, tool name, error message)
- **Audit logging**: Both success and failure are recorded with timestamps

**Tradeoff**: No automatic retry logic to avoid duplicate operations (e.g., creating duplicate products). Clients can implement retry if needed.

## Production Changes

### DNS
**Development**: Uses local hosts file entries (`127.0.0.1 shop.urumi.test`)
**Production**: Requires:
- Public DNS records for storefront domains
- TLS certificates via cert-manager or similar
- CNAME or A records pointing to ingress controller IP

### Ingress
**Development**: Minikube ingress add-on with HTTP-only
**Production**: Requires:
- Production-grade ingress controller (NGINX, Traefik, etc.)
- TLS termination at ingress level
- Rate limiting and WAF rules
- Geo-IP restrictions if needed

### Storage Class
**Development**: Default Minikube storage class (hostPath)
**Production**: Requires:
- Cloud provider storage class (AWS EBS, GCE PD, Azure Disk)
- Configurable reclaim policy (Retain for data safety)
- Backup/restore strategy
- Storage capacity planning based on store count

### Secrets
**Development**: Secrets created manually via kubectl
**Production**: Requires:
- External secret management (HashiCorp Vault, AWS Secrets Manager, etc.)
- Secret rotation policies
- Encryption at rest (cloud provider KMS)
- Audit logging for secret access
- Separate environments (dev/staging/prod) with different secrets

### Additional Production Considerations
- **High availability**: Multiple gateway replicas with pod anti-affinity
- **Database**: PostgreSQL with replication and automated backups
- **Monitoring**: Prometheus + Grafana for metrics, alerting on failures
- **Logging**: Centralized logging (ELK, Loki, etc.) with retention policies
- **RBAC**: Least-privilege service accounts, no cluster-admin usage
- **Network policies**: Restrict pod-to-pod communication to required paths only
- **Resource quotas**: Per-namespace limits to prevent resource exhaustion
