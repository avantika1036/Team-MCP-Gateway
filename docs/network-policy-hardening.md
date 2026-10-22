# Store MCP NetworkPolicy hardening

The store Helm chart owns the store NetworkPolicies for both the original/static store and stores created by the provisioner. The default policy allows normal same-namespace traffic for WordPress and MariaDB, but deliberately excludes pods labeled `app.kubernetes.io/component: woocommerce-mcp`. This matters because Kubernetes NetworkPolicies are additive: a broad same-namespace ingress allow would otherwise also let non-Gateway pods reach the MCP service.

The dedicated `allow-gateway-to-store-mcp` policy now:

- selects the WooCommerce MCP pod only;
- allows inbound TCP/3002 only from pods labeled `app.kubernetes.io/component: gateway` in the configured Gateway namespace;
- restricts MCP egress to its store namespace and cluster DNS (UDP/TCP 53).

The updated provisioner now passes the Gateway namespace into the Helm chart, and the Helm chart creates the policy objects. A new provisioner image is therefore required for newly provisioned stores. The existing static store can receive the policy through a Helm upgrade of its existing release; this should add NetworkPolicy resources without changing the database or PVC definitions.

## Validate on Minikube

1. Run `npm run check`, `helm lint charts/platform`, `helm lint charts/store`, and `git diff --check`.
2. Check whether the cluster actually enforces NetworkPolicies before expecting a deny result:

   ```powershell
   kubectl get pods -n kube-system -o wide
   kubectl get daemonsets -A | Select-String 'calico|cilium|antrea|kube-router|kindnet'
   ```

   A vanilla Minikube profile uses Kindnet, which does not enforce Kubernetes NetworkPolicies. The policy objects can still be reviewed there, but the negative connection test is meaningful only with a NetworkPolicy-capable CNI such as Calico. Do not replace the networking plugin in your existing demo cluster as part of this code change; use a separate test profile if needed.

3. Run `helm lint charts/store` and render its policies with `helm template store-policy-check charts/store --namespace urumi-store-policy-check --set-string networkPolicy.gatewayNamespace=urumi-platform`.
4. Build and load the updated provisioner image. The repository default is now `urumi/provisioner:0.1.2`; the Dockerfile copies `charts/store` into the image, so rebuild it when changing the store chart. From the repository root in PowerShell run:

   ```powershell
   docker build -f services/provisioner/Dockerfile -t urumi/provisioner:0.1.2 .
   minikube image load urumi/provisioner:0.1.2 -p urumi-local
   helm upgrade urumi-platform .\charts\platform `
     --namespace urumi-platform --reuse-values `
     --set-string provisioner.image.tag=0.1.2 --wait --timeout 10m
   kubectl rollout status deployment/urumi-platform-provisioner -n urumi-platform --timeout=180s
   kubectl get deployment urumi-platform-provisioner -n urumi-platform -o jsonpath='{.spec.template.spec.containers[0].image}'
   ```

   The last command should report `urumi/provisioner:0.1.2`. Do not continue to disposable-store testing until the rollout succeeds.
5. Create a disposable store (for example, `policy-check`) from the dashboard. Wait until its store MCP is ready.
6. Confirm the policies have the expected selectors:

   ```powershell
   kubectl get networkpolicy -n urumi-store-policy-check -o yaml
   ```

7. Confirm the Gateway is permitted to call the MCP health endpoint. From the Gateway pod, use Node's built-in fetch (the Gateway image runs Node):

   ```powershell
   kubectl exec -n urumi-platform deploy/urumi-platform-gateway -- node -e "fetch('http://store-policy-check-mcp.urumi-store-policy-check.svc.cluster.local:3002/healthz').then(async r=>{console.log(r.status);process.exit(r.ok?0:1)}).catch(e=>{console.error(e.message);process.exit(1)})"
   ```

   Adjust the service name only if the rendered release uses a different MCP Service name. A successful request should report HTTP 200.

8. Test the negative case from a temporary non-Gateway pod in the same store namespace. The MCP health request should time out or fail to connect. Do not run the negative case from a Gateway pod, and remove the temporary pod after the test.
9. Delete the disposable store through the dashboard, and verify its namespace is gone.

Do not upgrade production stores solely on the basis of a successful Helm render. First test both the allowed and denied connection paths on the actual cluster/CNI.
