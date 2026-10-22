# Deployment portability: local Minikube and production Gateway ingress

The platform Helm chart keeps ingress disabled by default. Choose a profile explicitly.

## Local Minikube

Validate both charts and render the platform with the local values:

```powershell
helm lint .\charts\platform
helm lint .\charts\store
helm template urumi-platform .\charts\platform --namespace urumi-platform -f .\charts\platform\values-local.yaml
```

To enable the local Gateway Ingress on an existing Minikube release:

```powershell
helm upgrade urumi-platform .\charts\platform `
  --namespace urumi-platform --reuse-values `
  -f .\charts\platform\values-local.yaml --wait --timeout 10m
```

In one PowerShell terminal, forward the Minikube ingress controller (adjust the Service name if yours differs):

```powershell
kubectl port-forward -n ingress-nginx svc/ingress-nginx-controller 8080:80
```

Ensure `127.0.0.1 mcp.urumi.test` is present in `C:\Windows\System32\drivers\etc\hosts`, then use `http://mcp.urumi.test:8080/dashboard/`. The existing direct Gateway port-forward at `http://127.0.0.1:4016` can remain as a fallback.

## Production-style Gateway ingress (k3s/VPS)

Before installing/upgrading, replace `mcp.example.com` in `charts/platform/values-prod.yaml` with a DNS name pointing to your ingress controller. Provision a certificate for that exact hostname and create the TLS Secret in the platform namespace:

```powershell
kubectl create namespace urumi-platform --dry-run=client -o yaml | kubectl apply -f -
kubectl create secret tls urumi-platform-tls -n urumi-platform `
  --cert C:\path\to\fullchain.pem --key C:\path\to\privkey.pem
helm lint .\charts\platform
helm template urumi-platform .\charts\platform --namespace urumi-platform -f .\charts\platform\values-prod.yaml
```

Upgrade only after reviewing the rendered manifest:

```powershell
helm upgrade --install urumi-platform .\charts\platform `
  --namespace urumi-platform --reuse-values `
  -f .\charts\platform\values-prod.yaml --wait --timeout 10m
```

The certificate Secret must match the configured hostname. The production file enables TLS for the platform Gateway Ingress; it does **not** create certificates or configure DNS, a StorageClass, backups, or a secrets manager.

## Important limitation: dynamically provisioned storefront TLS

Storefronts are created by the separate `charts/store` release and the provisioner computes public URLs from its `baseDomain`, `urlScheme`, and `urlPort` settings. This profile does not yet wire a per-store certificate flow (for example, cert-manager issuing a certificate for each store hostname). Do not expose dynamically provisioned stores publicly over HTTPS until that flow is implemented and tested. For the take-home demo, keep the local `urumi.test`/HTTP setup. Production deployment also requires hardened tenant isolation, tested restore procedures, secret rotation, resource sizing, and review of NetworkPolicies/RBAC.
