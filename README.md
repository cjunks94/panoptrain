# Panoptrain

Real-time NYC transit tracker. Polls MTA GTFS-RT feeds, interpolates train positions along route shapes, and renders them on an interactive map — subway and LIRR as switchable modes, a trip planner with alternative routes and live delay context, and a live aircraft/airspace mode above Manhattan (adsb.lol) with airport weather briefings.

**Live demo: [panoptrain.cjunker.dev](https://panoptrain.cjunker.dev/)** — subway, LIRR, and a live airspace mode, no install or API key needed.

## Prerequisites

- Node.js >= 20
- pnpm >= 10

## Setup

```bash
pnpm install
pnpm download-gtfs        # subway static GTFS (~one-time)
pnpm download-gtfs:lirr   # LIRR static GTFS (optional — needed for the LIRR tab)
```

**No API key required** — MTA's GTFS-RT feeds are publicly accessible.

## Environment Variables

Copy `.env.example` or create `.env` in the project root:

```
PORT=3001              # server port
POLL_INTERVAL_MS=30000 # poll cadence (ms) — read by both server and client
LOG_LEVEL=info         # info | debug
```

`POLL_INTERVAL_MS` drives both the server's MTA feed polling and the client's
`/api/trains` polling — `packages/client/vite.config.ts` loads the repo-root
`.env` and injects it as `VITE_POLL_INTERVAL_MS` at build time.

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
| `GET /api/subway/trains?routes=1,2,3` | Live subway train positions |
| `GET /api/subway/routes` | Subway route GeoJSON (cached 24h) |
| `GET /api/subway/stops` | Subway stop GeoJSON (cached 24h) |
| `GET /api/lirr/trains` | Live LIRR train positions |
| `GET /api/lirr/routes` | LIRR route GeoJSON (cached 24h) |
| `GET /api/lirr/stops` | LIRR stop GeoJSON (cached 24h) |
| `GET /api/plan?from=X&to=Y` | Subway trip plan (Dijkstra + alternatives, live delay ranges) |
| `GET /api/plan/lirr?from=X&to=Y&at=…` | LIRR schedule-based trip plan (direct + one-transfer) |
| `GET /api/airspace/aircraft` | Live aircraft positions over NYC (adsb.lol) |
| `GET /api/airspace/metar` | Airport weather observations (METAR) |
| `GET /api/airspace/taf` | Airport weather forecasts (TAF) |
| `GET /api/health` | Health check |
| `GET /api/trains` etc. | Legacy aliases for the subway endpoints (kept for back-compat) |

## Roadmap

Tracked in [docs/ROADMAP.md](docs/ROADMAP.md), audited against `main` on 2026-08-12. Most of
the original five epics have shipped — unified polling config, station clarity, the
multi-route trip planner with delay ranges, the mobile bottom sheet, LIRR as a second mode,
and the aircraft/airspace mode. What's still open (with honest partial-status notes) lives
there; looser enhancement ideas are in [BACKLOG.md](BACKLOG.md).
