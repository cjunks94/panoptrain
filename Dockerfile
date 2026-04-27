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

# Download static GTFS data — subway and LIRR. Baked into the image so the
# runtime container starts with data on disk; refreshes on every Docker
# rebuild (Railway rebuilds on git push). Single RUN keeps cache invalidation
# unified — both feeds depend on the same upstream layer so combining doesn't
# change re-download behavior.
#
# Strict failure on missing data is intentional: LIRR is a first-class mode
# now, and silent build success with empty /api/lirr/* would be worse than a
# loud deploy failure. Three-attempt retry absorbs transient MTA endpoint
# blips without making the build flaky.
RUN for cmd in "download-gtfs" "download-gtfs:lirr"; do \
      for attempt in 1 2 3; do \
        pnpm $cmd && break; \
        if [ $attempt -eq 3 ]; then exit 1; fi; \
        echo "GTFS $cmd attempt $attempt failed, retrying..."; \
        sleep 5; \
      done; \
    done

ENV NODE_ENV=production
ENV PORT=3001
ENV POLL_INTERVAL_MS=30000

EXPOSE 3001
CMD ["pnpm", "--filter", "@panoptrain/server", "start"]
