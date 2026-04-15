# Panoptrain

Real-time NYC subway train tracker. Polls MTA GTFS-RT feeds, interpolates train positions along route shapes, and renders them on an interactive map.

## Prerequisites

- Node.js >= 20
- pnpm >= 10

## Setup

```bash
pnpm install
pnpm download-gtfs   # downloads static MTA subway data (~one-time)
```

**No API key required** — MTA's GTFS-RT feeds are publicly accessible.

## Environment Variables

Copy `.env.example` or create `.env` in the project root:

```
PORT=3001              # server port
POLL_INTERVAL_MS=30000 # how often server polls MTA feeds (ms)
LOG_LEVEL=info         # info | debug
```

The client polls the server every 15s (configured in `packages/client/vite.config.ts`).

## Development

```bash
pnpm dev            # start both client and server
pnpm dev:server     # server only (http://localhost:3001)
pnpm dev:client     # client only (http://localhost:5173)
```

## Project Structure

```
packages/
  shared/   — TypeScript types (Zod schemas) and MTA route constants
  server/   — Hono backend: GTFS-RT polling, position interpolation, REST API
  client/   — React 19 + MapLibre: animated map, line filtering, status display
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/trains?routes=1,2,3` | Live train positions (optional route filter) |
| `GET /api/routes` | Route GeoJSON (cached 24h) |
| `GET /api/stops` | Stop GeoJSON (cached 24h) |
| `GET /api/health` | Health check |
