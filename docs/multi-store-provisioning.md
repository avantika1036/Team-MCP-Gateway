# Multi-store provisioning MVP

The platform's provisioner is an internal-only service. The control plane authenticates administrators and proxies store operations to the provisioner using a bearer token from Kubernetes Secrets. The provisioner is exposed only as a ClusterIP service.

## Create flow

1. Validate the store slug and enforce the configured active-store quota per owner.
2. Create a dedicated namespace and apply a `ResourceQuota` and `LimitRange`; the store Helm chart owns the `NetworkPolicy` resources.
3. Generate unique MariaDB root/application and WordPress administrator passwords into a Kubernetes Secret.
4. Install `charts/store` with MCP temporarily disabled and wait for WordPress/MariaDB readiness.
5. Generate a real WooCommerce read/write API key inside that store's WordPress deployment and store the credentials in a namespace-local Kubernetes Secret.
6. Upgrade the same Helm release with the WooCommerce MCP enabled and wait for its readiness probe.
7. The gateway registers the store's in-cluster MCP URL in its registry, then refreshes tool discovery.

## Delete flow

The gateway disables/removes the store's upstream tools, then asks the provisioner to uninstall the release and delete the dedicated namespace. Namespace deletion cleans up namespaced resources and PVCs; the dynamic storage provisioner is expected to reclaim the volume according to its StorageClass reclaim policy.

## Configuration

The `provisioner` section in `charts/platform/values.yaml` controls the image, base domain, URL scheme/port, namespace prefix and per-user store limit. For a local Minikube demo, the default site URLs use port `8080`; port-forward the ingress controller to `8080:80` and add each `<slug>.urumi.test` host to the Windows hosts file pointing at `127.0.0.1`. For a production k3s/VPS install, override `baseDomain`, set `urlScheme: https`, set `urlPort: ''`, configure DNS/TLS, and use a storage class suitable for the host.

## Security notes and limits

- Store names are restricted to safe DNS-style slugs. Existing namespaces are not adopted automatically.
- Each store has its own database credentials, WordPress administrator password, WooCommerce API key Secret, namespace, and persistent volumes.
- The store chart's namespace policy permits ingress-controller HTTP to storefront pods. The WooCommerce MCP pod is excluded from the general same-namespace allow rule and accepts inbound traffic only from Gateway pods in the configured Gateway namespace. Its egress is limited to the store namespace and cluster DNS. Kubernetes NetworkPolicies are additive, so keep the MCP pod excluded from broader allow policies. The chart owns these resources so a Helm upgrade can apply the same policy to an existing store.
- Quotas cap pods, CPU, memory, PVC count and requested storage. The per-user limit defaults to three active stores.
- The provisioner uses a dedicated Kubernetes ServiceAccount and a scoped ClusterRole because it must create/delete namespaces and install namespaced Helm resources. Review the rule set before production use.
- Provisioning is synchronous and may take several minutes. Failed create operations attempt Helm and namespace cleanup and leave a failure record for dashboard inspection.
- This MVP supports one provisioner replica. Before horizontal scaling, move operation locks/leases to PostgreSQL and add a durable background-job queue.

## Cluster version and provisioning permissions

The platform chart uses stable `admissionregistration.k8s.io/v1` ValidatingAdmissionPolicy resources (Kubernetes 1.30+). They restrict the provisioner ServiceAccount to creating/deleting namespaces under the configured store prefix and creating only the expected RoleBinding in those namespaces. The provisioner ClusterRole does not have RoleBinding update, patch, or delete permissions. Confirm your Kubernetes/k3s version supports ValidatingAdmissionPolicy before installing the platform chart.
