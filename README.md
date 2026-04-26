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
| `GET /api/trains?routes=1,2,3` | Live train positions (optional route filter) |
| `GET /api/routes` | Route GeoJSON (cached 24h) |
| `GET /api/stops` | Stop GeoJSON (cached 24h) |
| `GET /api/plan?from=X&to=Y` | Trip plan between two stops |
| `GET /api/health` | Health check |

## Roadmap

Tracked as three epics. Priority: **P0** = next up, **P1** = soon, **P2** = nice-to-have.

### Epic 1 — Real-time freshness & load performance
Goal: trains visible on screen reflect the latest server poll, payloads are minimal, first paint is fast.

| ID | P | Title | Notes |
|---|---|---|---|
| PT-101 | P0 | Unify poll interval config | Single `POLL_INTERVAL_MS` env read by both server and client (`packages/server/src/index.ts`, `packages/client/vite.config.ts`). Today the client hardcodes 15s while server defaults to 30s — they can drift. |
| PT-102 | P0 | Cache headers on `/api/trains` | Add `Cache-Control: public, max-age=5` so duplicate requests in a tick reuse the snapshot (`packages/server/src/routes/trains.ts`). Server-side `?routes=` filter already in place. |
| PT-103 | P1 | gzip/compression middleware | Hono doesn't compress by default; JSON `/api/trains` and `/api/routes` payloads will shrink ~70%. |
| PT-104 | P2 | Lazy-load route shapes | `useRouteShapes.ts` blocks first paint on full routes+stops GeoJSON. Split per-route or gate on zoom ≥ 12. |
| PT-105 | P2 | Smart client polling | Skip poll when tab is hidden / user is idle; back off when filter unchanged. |

### Epic 2 — Station clarity
Goal: at any common zoom, the user can tell *what* a station is, *which* routes serve it, and *what's happening* there.

| ID | P | Title | Notes |
|---|---|---|---|
| PT-201 | P0 | Show station labels at zoom 12+ | Today `station-labels` only appears at zoom ≥ 14 (`TransitMap.tsx:218`). Add an abbreviated layer at 12–13 or lower the min zoom. |
| PT-202 | P1 | Major-hub indicator | Stations with ≥ 8 serving routes get a larger / outlined marker so Times Sq, Atlantic, Union Sq stand out. |
| PT-203 | P1 | Route badges next to station name | Append top routes to the label at zoom 14+ (e.g., "Times Sq · 1 2 3"). Data is already in `StopFeature.properties.routes`. |
| PT-204 | P2 | Click station for arrivals panel | Filter the current `/api/trains` snapshot by `currentStopId` / `nextStopId` to show next arrivals — no new endpoint needed. |
| PT-205 | P2 | Label collision priority | Use MapLibre `symbol-sort-key` so major stations win the collision test against minor ones. |

### Epic 3 — Trip planner: primary + secondary routes
Goal: planner returns multiple route options and surfaces real-time delay context so the user can pick the best one *right now*.

| ID | P | Title | Notes |
|---|---|---|---|
| PT-301 | P0 | K-shortest paths in `planTrip` | Today `planTrip` returns a single Dijkstra result (`packages/server/src/services/trip-planner.ts:124`). Return top 2–3 (Yen's algorithm or deviation-path variant) as primary + alternatives. |
| PT-302 | P0 | Lower `/api/plan` response cache | `Cache-Control: max-age=3600` is too long for a route that overlays live delays. Drop to 60–120s (`packages/server/src/routes/plan.ts:37`). |
| PT-303 | P0 | Client UI for alternative routes | TripPlanner shows "Recommended / Fewer transfers / Fewer delays" tabs; selecting one highlights it on the map. |
| PT-304 | P1 | Delay range, not average | `enrichWithDelays` averages delays across in-route trains, hiding outliers. Show min–max + count ("1–5 min late, 3 of 4 trains"). |
| PT-305 | P1 | "Why this route?" explanation | Surface the trade-off (fewer transfers vs. faster) so users understand why each option ranks where it does. |
| PT-306 | P2 | Service alerts integration | Pull GTFS-RT alerts feed; flag segments under planned/active maintenance. |
| PT-307 | P2 | Smarter transfer time | Replace constant `TRANSFER_MIN = 1` with per-station heuristic based on platform geometry. |
| PT-308 | P2 | Flexible departure window | Show "leave now vs. in 5/10 min" impact based on next train ETAs. |
| PT-309 | P1 | Spotlight trains on selected trip | When a plan is active, highlight the live trains running the planned routes (e.g. brighten matching, dim others) and ensure the planned rail segments stay visually emphasized. Filter the train snapshot by `routeId` for each ride segment and surface ETA from the closest train to the boarding stop. |

### Epic 4 — Mobile-first design
Goal: every flow that works on desktop is equally usable on a phone. Existing e2e covers Pixel 7 and iPhone 14 viewports, but the panel still uses a desktop-shaped sidebar and the trip planner relies on `<datalist>` autocomplete that's flaky on iOS. Tracking the work to make mobile a first-class target.

| ID | P | Title | Notes |
|---|---|---|---|
| PT-401 | P0 | Touch target audit | Sweep `FilterPanel.tsx`, `TripPlanner.tsx`, `LineToggle.tsx` for buttons/toggles smaller than 44×44 px. Bump padding/min-height where needed without bloating the desktop layout. |
| PT-402 | P0 | Bottom-sheet panel below 480px | The 260px fixed left sidebar takes ~67% of an iPhone 14 viewport. Switch to a slide-up bottom sheet (or half-screen modal) at narrow widths so the map gets full use of the screen. |
| PT-403 | P1 | Replace `<datalist>` station picker | iOS Safari renders `<datalist>` inconsistently and doesn't filter as the user types. Build a small searchable combobox so mobile users can find stations without playing Whac-a-Mole with the keyboard. |
| PT-404 | P1 | Plan tab strip overflow | Three plan tabs (`Recommended · 14m / Avoids N · 14m / Alternative 1 · 30m`) overflow narrow viewports. Add horizontal scroll-snap or wrap below a breakpoint. |
| PT-405 | P1 | iOS safe-area insets | Honour `env(safe-area-inset-top/bottom)` on the panel and any fixed-position UI so the status badge and bottom-sheet handles clear the notch and home indicator. |
| PT-406 | P2 | Mobile performance audit | Profile RAF FPS and JS execution on a mid-range Android (Pixel 5-class) over throttled 4G. Tune `FRAME_INTERVAL` and dedup grid if needed. Capture a baseline so future changes don't regress. |
| PT-407 | P2 | Expand mobile e2e | Today mobile tests only cover viewport rendering; extend to a full plan flow on Pixel 7 / iPhone 14 (open panel → search → pick alternative → verify spotlight). |
