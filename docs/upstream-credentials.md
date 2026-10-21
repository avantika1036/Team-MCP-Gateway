# Optional upstream MCP credentials

The gateway supports an optional static credential for generic Streamable HTTP upstreams. An administrator can choose no authentication, a bearer token, or a custom HTTP header when registering or editing an upstream in the dashboard.

## Credential flow

1. The browser sends the credential once to the authenticated admin API when the upstream is created or its credential is changed. The form uses a password field.
2. The gateway keeps only non-secret authentication metadata (`bearer` or the custom header name) in `servers.json`. The JSON registry never stores the credential value.
3. The gateway sends the credential over its internal, bearer-protected provisioner connection. The provisioner writes it into the Kubernetes Secret named `<platform-release-fullname>-upstream-credentials`, under the data key `credential-<upstream-id>`.
4. On discovery or tool execution, the gateway requests only the credential for the relevant upstream ID from the internal provisioner endpoint, uses it to configure the MCP HTTP transport, and keeps it in process memory for that operation. Bearer mode sends `Authorization: Bearer <credential>`; custom-header mode sends the configured header.
5. The admin API returns only `authConfigured`, `authType`, and, for custom headers, `authHeaderName`. It never returns the credential. Credentials are not included in audit records or logs.

The credential retrieval endpoint is protected by the provisioner internal bearer token and is not exposed through the public gateway API. Requests to an authenticated upstream reject redirects so a server cannot redirect a credential-bearing request to another URL. Custom header names are validated and reserved/hop-by-hop headers are rejected.

## Kubernetes permissions

The provisioner receives a namespace-scoped Role in the platform namespace. `get`, `update`, `patch`, and `delete` are restricted using `resourceNames` to the dedicated upstream-credentials Secret. Kubernetes RBAC cannot constrain the name on `create`, so a `ValidatingAdmissionPolicy` additionally restricts the provisioner ServiceAccount to creating that one named Secret in the platform namespace. This policy does not limit the provisioner's separate, namespaced store-provisioning role.

The Secret is stored using Kubernetes Secret data. Kubernetes stores Secret data as base64 in the API representation; base64 is not encryption. Production clusters should enable and test encryption at rest for etcd, restrict access to Secret-reading principals, use TLS where traffic leaves a trusted cluster network, and rotate credentials after suspected exposure. The local Minikube deployment is a development environment, not evidence that etcd encryption is enabled.

## Supported admin API shape

Register an unauthenticated upstream by omitting `auth`:

```json
{
  "id": "inventory",
  "name": "Inventory MCP",
  "url": "http://inventory.urumi-platform.svc.cluster.local:4000/mcp"
}
```

Bearer token:

```json
{
  "id": "inventory",
  "name": "Inventory MCP",
  "url": "http://inventory.urumi-platform.svc.cluster.local:4000/mcp",
  "auth": {
    "type": "bearer",
    "credential": "<token>"
  }
}
```

Custom header:

```json
{
  "id": "inventory",
  "name": "Inventory MCP",
  "url": "http://inventory.urumi-platform.svc.cluster.local:4000/mcp",
  "auth": {
    "type": "header",
    "headerName": "X-API-Key",
    "credential": "<token>"
  }
}
```

For `PUT /api/admin/servers/:id`, omit `auth` to leave existing authentication unchanged. Send `"auth": null` to remove it, or send a new authentication object to rotate/change it. The UI presents these options without ever retrieving the stored credential.
