FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps ./apps
COPY services ./services
COPY packages ./packages

# Install development dependencies for TypeScript compilation.
# Remove them afterwards so the runtime image stays lean.
RUN npm ci --include=dev \
    && npm run build --workspace @urumi/woocommerce-mcp \
    && npm prune --omit=dev \
    && npm cache clean --force

ENV NODE_ENV=production

USER node

EXPOSE 3002

CMD ["npm", "run", "start", "--workspace", "@urumi/woocommerce-mcp"]
