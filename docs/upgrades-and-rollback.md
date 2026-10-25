# Upgrades and Rollback

This document demonstrates how to safely upgrade and rollback the Urumi MCP Gateway platform using Helm.

## Prerequisites

- Helm 3.x installed
- Kubernetes cluster running (Minikube, k3s, or production cluster)
- Platform already deployed via Helm

## Current Deployment Check

Check the current release status:

```bash
helm list -n urumi-platform
helm history urumi-platform -n urumi-platform
```

## Upgrade Process

### 1. Update Helm Charts

Pull the latest charts or make changes locally:

```bash
# If using a git repo
git pull origin main

# Or if testing local changes
cd charts/platform
```

### 2. Review Values Changes

Compare your current values with the new chart requirements:

```bash
helm show values ./charts/platform > new-values.yaml
diff values-local.yaml new-values.yaml
```

### 3. Perform Upgrade

```bash
helm upgrade urumi-platform ./charts/platform \
  -f charts/platform/values-local.yaml \
  -n urumi-platform \
  --timeout 5m
```

The upgrade will:
- Apply new Kubernetes manifests
- Update pod images if tags changed
- Apply configuration changes from values
- Roll out pods with zero downtime (if multiple replicas)
- Preserve existing data (PVCs are not deleted)

### 4. Verify Upgrade

```bash
# Check release status
helm status urumi-platform -n urumi-platform

# Check pod rollout
kubectl rollout status deployment/urumi-control-plane -n urumi-platform

# Check all pods are running
kubectl get pods -n urumi-platform

# Verify the application is working
curl http://localhost:4016/healthz
```

## Rollback Process

If an upgrade causes issues, rollback to a previous version:

### 1. Check History

```bash
helm history urumi-platform -n urumi-platform
```

This shows all revisions with their status and timestamps.

### 2. Rollback to Previous Version

```bash
# Rollback to previous revision
helm rollback urumi-platform -n urumi-platform

# Rollback to specific revision
helm rollback urumi-platform -n urumi-platform <revision-number>
```

### 3. Verify Rollback

```bash
# Check release status
helm status urumi-platform -n urumi-platform

# Verify pods are running
kubectl get pods -n urumi-platform

# Verify application health
curl http://localhost:4016/healthz
```

## Safe Upgrade Practices

### 1. Test in Non-Production First

Always test upgrades in a staging environment before production.

### 2. Use --dry-run First

Preview changes without applying:

```bash
helm upgrade urumi-platform ./charts/platform \
  -f charts/platform/values-local.yaml \
  -n urumi-platform \
  --dry-run --debug
```

### 3. Enable Auto-Rollback on Failure

Helm can automatically rollback if the upgrade fails:

```bash
helm upgrade urumi-platform ./charts/platform \
  -f charts/platform/values-local.yaml \
  -n urumi-platform \
  --timeout 5m \
  --atomic
```

The `--atomic` flag will automatically rollback if the upgrade fails.

### 4. Monitor During Upgrade

Watch the upgrade progress:

```bash
helm upgrade urumi-platform ./charts/platform \
  -f charts/platform/values-local.yaml \
  -n urumi-platform \
  --wait
```

The `--wait` flag waits until all pods are ready before returning.

## Example Upgrade Scenario

### Scenario: Update Gateway Image Tag

**Current values.yaml:**
```yaml
gateway:
  image:
    repository: urumi/control-plane
    tag: '0.1.13'
```

**New values.yaml:**
```yaml
gateway:
  image:
    repository: urumi/control-plane
    tag: '0.1.14'
```

**Upgrade command:**
```bash
helm upgrade urumi-platform ./charts/platform \
  -f charts/platform/values-local.yaml \
  -n urumi-platform
```

**Verify:**
```bash
kubectl get pods -n urumi-platform -w
# Watch the old pod terminate and new pod start
```

**If issues occur:**
```bash
helm rollback urumi-platform -n urumi-platform
```

## Store Upgrades

For individual stores, use the store Helm chart:

```bash
# Upgrade a specific store
helm upgrade urumi-store-<slug> ./charts/store \
  -f charts/store/values-<slug>.yaml \
  -n urumi-store-<slug>

# Rollback a store
helm rollback urumi-store-<slug> -n urumi-store-<slug>
```

## Troubleshooting

### Upgrade Stuck

If an upgrade hangs:
```bash
# Check Helm status
helm status urumi-platform -n urumi-platform

# Force rollback if needed
helm rollback urumi-platform -n urumi-platform --force
```

### Pods Not Starting

```bash
# Check pod events
kubectl describe pod <pod-name> -n urumi-platform

# Check pod logs
kubectl logs <pod-name> -n urumi-platform
```

### Values Not Applied

```bash
# Verify values were applied
helm get values urumi-platform -n urumi-platform

# Compare with expected values
diff values-local.yaml <(helm get values urumi-platform -n urumi-platform -o yaml)
```

## Best Practices

1. **Always backup before major upgrades** - backup PostgreSQL data
2. **Document your values files** - keep them in version control
3. **Use semantic versioning** for image tags (e.g., 0.1.13, 0.1.14)
4. **Test upgrades regularly** - don't wait until production needs it
5. **Monitor after upgrade** - check logs and metrics for issues
6. **Keep rollback window open** - don't delete old revisions immediately
