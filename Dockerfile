FROM node:22-slim
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /app

# Install dependencies
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN pnpm install --frozen-lockfile

# Copy source
COPY tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY packages/server/ packages/server/
COPY packages/client/ packages/client/

# Build client static files
RUN pnpm --filter @panoptrain/client build

# Download static GTFS data
RUN pnpm download-gtfs

ENV NODE_ENV=production
ENV PORT=3001
ENV POLL_INTERVAL_MS=30000

EXPOSE 3001
CMD ["pnpm", "--filter", "@panoptrain/server", "start"]
