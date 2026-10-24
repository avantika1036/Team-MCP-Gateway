# Documentation Table of Contents

This document provides an overview of all documentation files in the Urumi Team MCP Gateway project.

## Core Documentation

### [README.md](../README.md)
- **Overview:** Main project documentation with quick start guide, architecture, and setup instructions
- **Sections:**
  - Features
  - Architecture diagram
  - Repository layout
  - Prerequisites
  - Quick Start Guide (first-time setup)
  - Running the project (subsequent runs)
  - Accessing the application
  - Login instructions (admin and chat)
  - VPS/Production deployment
  - User stories and testing
  - Troubleshooting
  - Project documentation links

### [System Design and Tradeoffs](system-design-and-tradeoffs.md)
- **Overview:** Architecture choices, tool aggregation, routing, failure handling, and production considerations
- **Sections:**
  - Architecture choices (MCP Gateway pattern, Streamable HTTP, tool name prefixing)
  - Tool aggregation, routing, and failure handling
  - Production changes (DNS, ingress, storage class, secrets)
  - Additional production considerations

### [Threat Model](threat-model.md)
- **Overview:** Security analysis of credential handling and user capabilities
- **Sections:**
  - Shared upstream credentials (what members can/cannot do)
  - Why client tokens are not passed through to upstream servers
  - Untrusted upstreams (tool descriptions to manipulate the model)
  - What one team member can do to another

## Setup and Deployment

### [Fresh Local Minikube Setup](local-minikube.md)
- **Overview:** Step-by-step PowerShell guide for setting up a local Minikube environment
- **Sections:**
  - Start Minikube and create namespace
  - Create platform Secrets
  - Build and load Docker images
  - Validate and install platform
  - Start local port-forwards
  - Bootstrap database-backed administrator
  - Create first store through provisioner
  - Verify independent MCP client
  - Cleanup

### [Chat Agent Configuration](chat-agent.md)
- **Overview:** How the chat agent works and how to configure the LLM provider
- **Sections:**
  - Provider configuration (Groq API, model settings)
  - Request limits and behavior
  - Secret requirements

### [Multi-Store Provisioning](multi-store-provisioning.md)
- **Overview:** How the store provisioning system works
- **Sections:**
  - Create flow (namespace creation, credentials, Helm install, MCP registration)
  - Delete flow (upstream removal, Helm uninstall, namespace deletion)
  - Configuration (base domain, URL scheme, namespace prefix)
  - Security notes and limits
  - Cluster version and provisioning permissions

### [Deployment Portability](deployment-portability.md)
- **Overview:** How to deploy the same charts to different environments
- **Sections:**
  - Local vs production differences
  - Helm values overrides
  - Environment-specific configurations

### [Network Policy Hardening](network-policy-hardening.md)
- **Overview:** Security hardening with Kubernetes NetworkPolicies
- **Sections:**
  - Default deny policies
  - Specific allow rules
  - Isolation between components

## Security and Operations

### [Security and Design Trade-offs](security-and-design.md)
- **Overview:** Security model and architectural trade-offs
- **Sections:**
  - Credential storage
  - Access control
  - Audit logging
  - Isolation strategies

### [Upstream Credentials](upstream-credentials.md)
- **Overview:** How upstream server authentication works
- **Sections:**
  - Credential types (bearer token, custom header)
  - Secret storage
  - Credential lifecycle
  - Security considerations

## Testing and Validation

### [Demo Runbook and Acceptance Checklist](demo-runbook.md)
- **Overview:** Step-by-step checklist for demonstrating all required features
- **Sections:**
  - Preflight checks
  - Gateway, authentication, and aggregation
  - WooCommerce end-to-end workflow
  - Chat-agent workflow
  - Independent MCP client
  - Multi-store isolation and lifecycle
  - Submission artifacts
  - Evidence log
  - Optional upstream credential verification

## Quick Reference

### API Key Retrieval

**Admin API Key (from local file):**
```powershell
Get-Content "$env:USERPROFILE\.urumi-secrets\dashboard-admin-api-key.txt" -Raw |
    Set-Clipboard
```

**Member API Key (from local file):**
```powershell
Get-Content "$HOME\.urumi-secrets\demo-member-api-key-2.txt" -Raw |
    ForEach-Object { Set-Clipboard -Value $_.Trim() }
Write-Host "Member API key copied to clipboard."
```

**Admin API Key (from Kubernetes secret):**
```powershell
kubectl get secret -n urumi-platform urumi-gateway-admin -o jsonpath='{.data.admin-token}' | base64 -d | Set-Clipboard
```

### Common Commands

**Check pod status:**
```powershell
kubectl get pods -n urumi-platform
kubectl get pods -n urumi-store
```

**View logs:**
```powershell
kubectl logs -n urumi-platform deployment/urumi-platform-gateway
```

**Port-forward services:**
```powershell
# Gateway
kubectl port-forward -n urumi-platform svc/urumi-platform-gateway 4016:4000

# Ingress
kubectl port-forward -n ingress-nginx svc/ingress-nginx-controller 8080:80
```

**List secrets:**
```powershell
kubectl get secrets -n urumi-platform
```

### Access URLs

- **Admin Dashboard:** http://localhost:5173/dashboard/
- **Chat Agent:** http://localhost:5173/chat/
- **Storefront:** http://shop.urumi.test:8080/
- **WooCommerce Admin:** http://shop.urumi.test:8080/wp-admin/
- **Gateway MCP:** http://localhost:4016/mcp
