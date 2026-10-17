FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps ./apps
COPY services ./services
COPY packages ./packages

RUN npm ci --include=dev
RUN npm run build --workspace @urumi/calculator-mcp
RUN npm prune --omit=dev && npm cache clean --force

ENV NODE_ENV=production
ENV PORT=4001
ENV MCP_HOST=0.0.0.0

USER node

EXPOSE 4001

CMD ["npm", "run", "start", "--workspace", "@urumi/calculator-mcp"]
