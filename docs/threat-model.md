# Threat Model

## Shared Upstream Credentials

### What a Member Can Do With a Credential They Never See

Members authenticate to the gateway with their own API key, which is hashed and stored in PostgreSQL. Upstream credentials (e.g., WooCommerce API keys) are stored separately in Kubernetes Secrets and are never exposed to the member's browser or client.

**What a member CAN do:**
- Call tools that use the shared upstream credential
- See tool results (which may include data from the upstream service)
- Potentially infer upstream behavior through tool responses

**What a member CANNOT do:**
- Extract the raw upstream credential (it's never returned to the client)
- Use the credential directly against the upstream service
- Access other members' data (unless the upstream service itself doesn't isolate by tenant)
- Modify the upstream credential configuration (requires admin role)

**Mitigations:**
- Credentials stored in Kubernetes Secrets with RBAC-restricted access
- Gateway applies credentials server-side before forwarding requests
- Audit log records all tool calls with user identity
- Admin can revoke user API keys at any time
- Upstream URL validation prevents arbitrary external service access

## Why Client Tokens Are Not Passed Through to Upstream Servers

Client API keys are used for authentication and authorization at the gateway level. They are NOT forwarded to upstream MCP servers for several reasons:

1. **Credential isolation**: Upstream servers should not need to know about gateway user management
2. **Least privilege**: Upstream servers only receive the credentials they need (their own API keys)
3. **Audit trail**: The gateway records the user identity before calling upstreams
4. **Upstream compatibility**: Many upstream services (e.g., WooCommerce) have their own credential schemes and don't understand gateway tokens
5. **Security boundary**: Compromise of an upstream server should not expose all user API keys

**Attack scenario if tokens were passed through:**
- If an upstream MCP server were compromised, it could log or replay user API keys
- The attacker could use those keys to impersonate users against the gateway
- This would bypass the gateway's access controls and audit logging

**Current design:**
- Gateway authenticates user with their API key
- Gateway maps user to their role (admin/member)
- Gateway retrieves upstream-specific credentials from its own secret store
- Gateway calls upstream with only the upstream's credentials
- Upstream sees the gateway as the caller, not the end user

## Untrusted Upstreams: Tool Descriptions Written to Manipulate the Model

An upstream server could provide malicious tool descriptions designed to:
- Mislead the LLM about what a tool does
- Encourage the LLM to call tools in harmful sequences
- Exfiltrate data through crafted tool outputs

**Mitigations:**
1. **Admin approval required**: Only admins can register upstream servers
2. **Upstream URL validation**: Arbitrary external URLs are blocked; only approved host suffixes (`.svc`, `.svc.cluster.local`, localhost) are allowed
3. **Tool name prefixing**: All tools are prefixed with upstream ID, making the source explicit
4. **Audit logging**: All tool calls are logged with user identity, allowing detection of unusual patterns
5. **Upstream isolation**: Failed or malicious upstreams can be disabled without affecting others
6. **Network policies**: In production, network policies can restrict which upstreams the gateway can reach

**Remaining risks:**
- A compromised in-cluster upstream could still provide misleading descriptions
- The LLM may be tricked into calling tools in unexpected ways
- Tool outputs could contain malicious content (e.g., XSS in product descriptions)

**Recommendations for production:**
- Review tool descriptions before approving upstream registration
- Implement tool output sanitization for user-facing content
- Consider rate limiting per user to prevent tool abuse
- Monitor audit logs for unusual tool call patterns

## What One Team Member Can Do to Another

### Member-to-Member Capabilities

**What a member CAN do to other members:**
- Nothing directly - members have no admin privileges
- Cannot create, modify, or delete other users
- Cannot revoke other users' API keys
- Cannot access other users' audit logs (admin-only)

**What a member CAN do indirectly:**
- If they share the same upstream credential (e.g., WooCommerce API key), they can see/manipulate the same data
- This is a limitation of the upstream service, not the gateway
- For multi-tenant upstreams, the upstream service must implement tenant isolation

**What an admin CAN do to members:**
- Create and delete users
- Revoke API keys
- View all audit logs
- Enable/disable upstream servers (affects all members)
- Modify upstream credentials (affects all members using that upstream)

**Mitigations:**
- Role-based access control (admin vs member)
- Audit logging of all admin actions
- Admin actions require separate admin token or admin role
- Upstream credential changes are logged

**Recommendations for production:**
- Use separate upstream credentials per tenant where possible
- Implement approval workflows for sensitive admin actions
- Regular audit log reviews
- Separate admin accounts for day-to-day operations vs emergency access
