#!/bin/sh
set -eu

SERVICE_ACCOUNT_DIR="/var/run/secrets/kubernetes.io/serviceaccount"
if [ ! -r "$SERVICE_ACCOUNT_DIR/token" ] || [ ! -r "$SERVICE_ACCOUNT_DIR/ca.crt" ]; then
  echo "Kubernetes service-account credentials are unavailable." >&2
  exit 1
fi

: "${KUBERNETES_SERVICE_HOST:?KUBERNETES_SERVICE_HOST is not set}"
KUBERNETES_SERVICE_PORT_HTTPS="${KUBERNETES_SERVICE_PORT_HTTPS:-443}"

cat > /tmp/urumi-provisioner-kubeconfig <<EOF
apiVersion: v1
kind: Config
clusters:
  - name: in-cluster
    cluster:
      server: https://${KUBERNETES_SERVICE_HOST}:${KUBERNETES_SERVICE_PORT_HTTPS}
      certificate-authority: ${SERVICE_ACCOUNT_DIR}/ca.crt
users:
  - name: in-cluster
    user:
      tokenFile: ${SERVICE_ACCOUNT_DIR}/token
contexts:
  - name: in-cluster
    context:
      cluster: in-cluster
      user: in-cluster
current-context: in-cluster
EOF
chmod 0600 /tmp/urumi-provisioner-kubeconfig
export KUBECONFIG=/tmp/urumi-provisioner-kubeconfig
exec node /app/services/provisioner/dist/index.js
