FROM node:22-slim
RUN npm install -g pnpm@10

WORKDIR /app

# Install with layer caching: manifests first, then sources.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/plugin-sdk/package.json packages/plugin-sdk/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

ENV NODE_ENV=production \
    DATABASE_PATH=/data/coord.db \
    WEB_DIST=/app/apps/web/dist \
    PORT=3000

EXPOSE 3000
VOLUME /data

WORKDIR /app/apps/server
CMD ["pnpm", "start"]
