FROM node:24-alpine

ARG TARGETARCH=amd64
ARG HELM_VERSION=v3.18.6
ARG KUBECTL_VERSION=v1.36.0

RUN apk add --no-cache ca-certificates curl tar gzip \
    && curl -fsSL "https://get.helm.sh/helm-${HELM_VERSION}-linux-${TARGETARCH}.tar.gz" -o /tmp/helm.tgz \
    && tar -xzf /tmp/helm.tgz -C /tmp \
    && install -m 0755 "/tmp/linux-${TARGETARCH}/helm" /usr/local/bin/helm \
    && curl -fsSL "https://dl.k8s.io/release/${KUBECTL_VERSION}/bin/linux/${TARGETARCH}/kubectl" -o /usr/local/bin/kubectl \
    && chmod 0755 /usr/local/bin/kubectl \
    && rm -rf /tmp/helm.tgz "/tmp/linux-${TARGETARCH}"

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps ./apps
COPY services ./services
COPY packages ./packages
COPY charts/store ./charts/store

RUN npm ci --include=dev \
    && npm run build --workspace @urumi/provisioner \
    && npm prune --omit=dev \
    && npm cache clean --force \
    && mkdir -p /home/node/.cache/helm /home/node/.config/helm /home/node/.local/share/helm \
    && chmod 0755 /app/services/provisioner/entrypoint.sh \
    && chown -R node:node /app /home/node

ENV NODE_ENV=production
ENV PORT=4100
ENV STORE_CHART_PATH=/app/charts/store
ENV HELM_CACHE_HOME=/home/node/.cache/helm
ENV HELM_CONFIG_HOME=/home/node/.config/helm
ENV HELM_DATA_HOME=/home/node/.local/share/helm

USER node
EXPOSE 4100
CMD ["/app/services/provisioner/entrypoint.sh"]
