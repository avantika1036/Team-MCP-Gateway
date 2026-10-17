FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps ./apps
COPY services ./services
COPY packages ./packages

RUN npm ci --include=dev
RUN npm run build --workspace @urumi/control-plane
RUN npm prune --omit=dev \
    && npm cache clean --force \
    && mkdir -p /app/data \
    && chown node:node /app/data

ENV NODE_ENV=production
ENV PORT=4000
ENV MCP_HOST=0.0.0.0
ENV REGISTRY_FILE=/app/data/servers.json

USER node

EXPOSE 4000

CMD ["npm", "run", "start", "--workspace", "@urumi/control-plane"]
