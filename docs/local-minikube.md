# Fresh Local Minikube Setup (PowerShell)

This is a reference installation flow for Windows PowerShell 5.1. It creates a disposable local platform from the repository and uses the provisioner to create the first WooCommerce store. Run the commands from the repository root. The steps create local Kubernetes resources and can take several minutes; do not run them against a cluster that contains important data.

## 1. Start Minikube and create the namespace

```powershell
minikube start -p urumi-local
minikube addons enable ingress -p urumi-local
kubectl config use-context urumi-local

$namespace = 'urumi-platform'
kubectl create namespace $namespace --dry-run=client -o yaml | kubectl apply -f -
```

Confirm your current context before creating or deleting resources:

```powershell
kubectl config current-context
kubectl get nodes
```

## 2. Create the platform Secrets

The following uses a random local-demo database password and bootstrap token. Values are piped directly to `kubectl apply` and are not echoed to the terminal. For a shared or production cluster, use the approved secret-management workflow instead.

```powershell
$dbName = 'urumi_gateway'
$dbUser = 'urumi_gateway'
$dbPassword = [guid]::NewGuid().ToString('N')
$adminToken = 'urm_admin_' + [guid]::NewGuid().ToString('N')
$databaseUrl = "postgresql://$dbUser`:$dbPassword@urumi-platform-postgres.urumi-platform.svc.cluster.local:5432/$dbName"

$databaseSecret = @"
apiVersion: v1
kind: Secret
metadata:
  name: urumi-gateway-db
  namespace: $namespace
type: Opaque
stringData:
  postgres-db: "$dbName"
  postgres-user: "$dbUser"
  postgres-password: "$dbPassword"
  database-url: "$databaseUrl"
"@
$databaseSecret | kubectl apply -f -

$adminSecret = @"
apiVersion: v1
kind: Secret
metadata:
  name: urumi-gateway-admin
  namespace: $namespace
type: Opaque
stringData:
  admin-token: "$adminToken"
"@
$adminSecret | kubectl apply -f -
```

Create the LLM Secret without echoing the API key:

```powershell
$secureGroqKey = Read-Host 'Enter your Groq API key' -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureGroqKey)
try {
    $groqKey = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $groqKeyBase64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($groqKey))
    $llmSecret = @"
apiVersion: v1
kind: Secret
metadata:
  name: urumi-llm-credentials
  namespace: $namespace
type: Opaque
data:
  api-key: $groqKeyBase64
"@
    $llmSecret | kubectl apply -f -
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    Remove-Variable groqKey, groqKeyBase64, llmSecret -ErrorAction SilentlyContinue
    Remove-Variable secureGroqKey -ErrorAction SilentlyContinue
}
```

## 3. Build and load all images

The image tags below match the repository's current default chart values, including generic upstream credential support:

```powershell
docker build -f services/control-plane/Dockerfile -t urumi/control-plane:0.1.11 .
docker build -f services/provisioner/Dockerfile -t urumi/provisioner:0.1.2 .
docker build -f services/calculator-mcp/Dockerfile -t urumi/calculator-mcp:0.1.0 .
docker build -f services/utility-mcp/Dockerfile -t urumi/utility-mcp:0.1.0 .
docker build -f services/woocommerce-mcp/Dockerfile -t urumi/woocommerce-mcp:0.1.7 .
docker build -f images/wordpress-woocommerce/Dockerfile -t urumi/wordpress-woocommerce:0.1.1 .

minikube image load urumi/control-plane:0.1.11 -p urumi-local
minikube image load urumi/provisioner:0.1.2 -p urumi-local
minikube image load urumi/calculator-mcp:0.1.0 -p urumi-local
minikube image load urumi/utility-mcp:0.1.0 -p urumi-local
minikube image load urumi/woocommerce-mcp:0.1.7 -p urumi-local
minikube image load urumi/wordpress-woocommerce:0.1.1 -p urumi-local
```

For an **existing** local installation that only needs the updated provisioner image, build and load the image, then upgrade the platform without reinstalling stores:

```powershell
docker build -f services/provisioner/Dockerfile -t urumi/provisioner:0.1.2 .
minikube image load urumi/provisioner:0.1.2 -p urumi-local
helm upgrade urumi-platform .\charts\platform `
  --namespace urumi-platform --reuse-values `
  --set-string provisioner.image.tag=0.1.2 --wait --timeout 10m
kubectl rollout status deployment/urumi-platform-provisioner -n urumi-platform --timeout=180s
```

If you change a tag in `charts/platform/values.yaml` or `charts/store/values.yaml`, build and load the matching tag before installing/upgrading.

## 4. Validate and install the platform

```powershell
helm lint .\charts\platform
helm lint .\charts\store
helm upgrade --install urumi-platform .\charts\platform `
  --namespace urumi-platform --wait --timeout 10m

kubectl get pods -n urumi-platform
kubectl get pvc -n urumi-platform
```

The bootstrap registry includes a legacy `woocommerce` upstream URL for a static release named `urumi-store`. If you are not installing that static store, it will be unreachable until removed; the dynamic store created below registers its own `store-<slug>` upstream automatically.

## 5. Start local port-forwards

Use two terminals and leave both commands running. If the ingress service name differs in your Minikube installation, inspect it with `kubectl get svc -A` and use the actual controller Service.

```powershell
kubectl port-forward -n urumi-platform svc/urumi-platform-gateway 4016:4000
```

In the second terminal:

```powershell
kubectl port-forward -n ingress-nginx svc/ingress-nginx-controller 8080:80
```

## 6. Bootstrap a database-backed administrator

In a third PowerShell terminal, retrieve the bootstrap token into a variable without printing it, then create the first admin user through the API. The returned database-backed API key is copied to the clipboard; do not paste it into chat or source control.

```powershell
$gatewayUrl = 'http://127.0.0.1:4016'
$adminToken = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String(
  (kubectl get secret urumi-gateway-admin -n urumi-platform -o jsonpath='{.data.admin-token}')
))
$bootstrapHeaders = @{ Authorization = "Bearer $adminToken" }

$createdAdmin = Invoke-RestMethod -Method Post `
  -Uri "$gatewayUrl/api/admin/users" `
  -Headers $bootstrapHeaders `
  -ContentType 'application/json' `
  -Body (@{
    email = 'platform-admin@urumi.local'
    displayName = 'Platform Admin'
    role = 'admin'
    keyName = 'initial-admin'
  } | ConvertTo-Json)

$adminApiKey = $createdAdmin.apiKey
Set-Clipboard -Value $adminApiKey
$adminHeaders = @{ Authorization = "Bearer $adminApiKey" }
Write-Host 'Database-backed admin created. API key copied to clipboard.'
Remove-Variable createdAdmin, adminToken, bootstrapHeaders
```

The bootstrap token is meant for initial setup, not everyday user operations. Use the database-backed admin API key for the dashboard and store lifecycle.

## 7. Create the first store through the provisioner

```powershell
$store = Invoke-RestMethod -Method Post `
  -Uri "$gatewayUrl/api/admin/stores" `
  -Headers $adminHeaders `
  -ContentType 'application/json' `
  -Body (@{ slug = 'main-store'; displayName = 'Main Store' } | ConvertTo-Json)

$store.store | Select-Object slug, status, namespace, siteUrl, upstreamId
```

The operation may take a few minutes while it creates the namespace, database, WordPress site and WooCommerce MCP server. Confirm readiness:

```powershell
kubectl get pods -n urumi-store-main-store
kubectl get pvc -n urumi-store-main-store
```

Add the site to the Windows hosts file from an **elevated** PowerShell terminal:

```powershell
Add-Content -Path "$env:WINDIR\System32\drivers\etc\hosts" -Value '127.0.0.1 main-store.urumi.test'
```

Then open <http://main-store.urumi.test:8080/>. If you did not deploy the static `urumi-store` release, remove the unreachable legacy `woocommerce` upstream from the admin console (or `DELETE /api/admin/servers/woocommerce`) after confirming `store-main-store` is healthy.

## 8. Verify an independent MCP client

Keep `$gatewayUrl` and `$adminApiKey` private in the terminal. Set environment variables only for the test process, list tools, then call a safe read-only tool:

```powershell
$env:URUMI_MCP_URL = "$gatewayUrl/mcp"
$env:URUMI_MCP_API_KEY = $adminApiKey
npm run smoke:mcp --workspace @urumi/control-plane
npm run smoke:mcp --workspace @urumi/control-plane -- store-main-store__list_products '{"page":1,"per_page":10}'
Remove-Item Env:\URUMI_MCP_API_KEY
Remove-Item Env:\URUMI_MCP_URL
```

The client only needs the gateway URL and Urumi API key; it does not need upstream URLs, WooCommerce credentials, or the Groq key.

## Cleanup

This is a disposable demo environment. Deleting a store from the gateway removes its Helm release and namespace. The actual fate of PersistentVolumes depends on the StorageClass reclaim policy. To delete the entire demo platform, first confirm the Kubernetes context, export any evidence you need, then remove the platform release and namespace deliberately; do not run broad `kubectl delete` commands against a shared cluster.
