# Roadmap

Audited against `main` on 2026-08-12 — every status below was verified against the code, not
carried over from the original ticket text. Legend: ✅ shipped · 🔶 partial · ⬜ not started ·
🔁 superseded.

Enhancement ideas that never had ticket IDs live in [BACKLOG.md](../BACKLOG.md).

## Status at a glance

| Epic | ✅ Shipped | 🔶 Partial | ⬜ Open |
|---|---|---|---|
| 1 — Real-time freshness | PT-101, PT-102, PT-103, PT-105 | PT-104 | — |
| 2 — Station clarity | PT-201, PT-202, PT-203, PT-205 | — | PT-204 |
| 3 — Trip planner | PT-301…PT-305, PT-309 | — | PT-306, PT-307, PT-308 |
| 4 — Mobile-first | PT-402, PT-404, PT-407 | PT-401, PT-406 | PT-403, PT-405 |
| 5 — Multi-mode (LIRR) | PT-501…PT-504, PT-506, PT-507 | PT-505 | PT-509, PT-510 |
| Airspace mode (ex-PT-601) | ✅ v1 shipped | see BACKLOG "Airspace v2" | — |

PT-508 🔁 is superseded (see [Superseded](#superseded)) and is not remaining work.

## Shipped

One line each; see git history for the PRs.

- **PT-101** — `POLL_INTERVAL_MS` read from the repo-root `.env` by both server
  (`packages/server/src/index.ts`) and client (`packages/client/vite.config.ts` injects
  `VITE_POLL_INTERVAL_MS`). No 15s hardcode remains.
- **PT-102** — `Cache-Control: public, max-age=5` on all trains endpoints via the shared
  `createTrainsRouter` factory (`packages/server/src/routes/trains.ts`).
- **PT-103** — `hono/compress` on `/api/*` with a regression test
  (`packages/server/src/__tests__/compress.test.ts`).
- **PT-105** — Train polling stops on hidden tabs and restarts on
  `visibilitychange`/`pageshow`/`focus` (`packages/client/src/hooks/useTrainPositions.ts`).
- **PT-201** — `station-labels-major` layer at zoom 12–14 for importance ≥ 1 stations;
  detailed labels remain at 14+ (`TransitMap.tsx`).
- **PT-202** — Server-computed `importance` (route count ≥ 8 → hub; curated list for LIRR)
  drives marker radius/stroke and a popup hub badge (`packages/server/src/routes/static.ts`,
  `StopPopup.tsx`).
- **PT-203** — Detailed labels show `Name · 1 2 3 +N` built from
  `StopFeature.properties.routes` (`useRouteShapes.ts` `enrichStops`, memoized).
- **PT-205** — `symbol-sort-key` by importance on both label layers, so major stations win
  collisions.
- **PT-301** — `planTrips(…, k = 3)`: Dijkstra primary + route-exclusion and ride-edge
  deviation alternatives, deduped (`packages/server/src/services/trip-planner.ts`).
- **PT-302** — `/api/plan` cache lowered to `max-age=60`, asserted in `plan.test.ts`.
- **PT-303** — Plan tabs in `TripPlanner.tsx` (labels are the server's
  `Recommended / Avoids X / Alternative N`, not the ticket's original wording).
- **PT-304** — `enrichWithDelays` returns min–max + train count, rendered as
  `+2-5 min late · 3 trains`; no averaging.
- **PT-305** — `explainPlan()` renders a "Why: …" line per alternative.
- **PT-309** — Active plan dims non-plan trains, emphasizes plan route lines, and shows a
  boarding-stop ETA from the closest live train.
- **PT-402** — Bottom sheet below **767px** (not the spec'd 480px): 75vh slide-up panel
  with drag handle and velocity-based swipe-to-dismiss (`FilterPanel.tsx`,
  `lib/bottomSheetSwipe.ts`), covered by mobile e2e.
- **PT-404** — Plan tabs and preset chips wrap (`flexWrap`) instead of scroll-snap; mobile
  e2e asserts no clipping.
- **PT-407** — `mobile.spec.ts` runs a full plan flow (search → Find Route → alternative
  tab) on Pixel 7 + iPhone 14 projects. Gap: no assertion on the map spotlight layers.
- **PT-501…PT-504** — Mode-parametrised cache/poller/GTFS loader, `LIRR_FEEDS` + LIRR
  static download, `/api/lirr/*` endpoints with `/api/trains` kept as subway alias, and the
  tab switcher (now three tabs: Subway | LIRR | Airspace) persisting under `panoptrain.view`
  (migrates the legacy `panoptrain.mode` key).
- **PT-506** — `LIRR_ROUTE_GROUPS`: 12 groups covering all 11 branches + City Terminal with
  MTA colors.
- **PT-507** — Auto-fit viewport on mode switch, bbox derived from loaded shapes rather
  than hardcoded.
- **Airspace mode** (BACKLOG's ex-PT-601) — shipped as a third mutually-exclusive mode tab
  (Subway | LIRR | Airspace), not co-rendered with transit. adsb.lol poller +
  `/api/airspace/*` with METAR/TAF, smoothed client markers, aircraft/airport popups,
  airport directory + briefing panels, ODbL attribution. Deviations from the original spec
  (including the spec'd independent overlay toggle) are tracked in BACKLOG "Airspace v2".

## Remaining work

Priority: **P0** = next up, **P1** = soon, **P2** = nice-to-have.

### Epic 1 — Real-time freshness

| ID | P | Status | Title | Notes |
|---|---|---|---|---|
| PT-104 | P2 | 🔶 | Lazy-load route shapes | What shipped: independent stops/routes resolution, abort on mode switch, per-mode memory cache, idle preload of the inactive mode. Still open: the full multi-MB GeoJSON is fetched up front — no per-route splitting or zoom gating (`route-lines` has no `minzoom`). |

Audit follow-ups (small, found 2026-08-12): the aircraft poller hardcodes `POLL_INTERVAL = 8_000`
(`useAircraftPositions.ts`) against the server's `AIRSPACE_POLL_INTERVAL_MS` — same drift class
PT-101 fixed for trains; and `useBulkPollingEndpoint` (aircraft/METAR/TAF) has no hidden-tab
gating, so PT-105's behavior doesn't extend to the airspace mode.

### Epic 2 — Station clarity

| ID | P | Status | Title | Notes |
|---|---|---|---|---|
| PT-204 | P2 | ⬜ | Click station for arrivals panel | `StopPopup` shows name/ID/route chips only. Filter the current trains snapshot by `currentStopId`/`nextStopId` — no new endpoint needed. |

### Epic 3 — Trip planner

| ID | P | Status | Title | Notes |
|---|---|---|---|---|
| PT-306 | P2 | ⬜ | Service alerts integration | No alerts feed URL, poller, schema, or UI exists for either mode (also blocks PT-509). |
| PT-307 | P2 | ⬜ | Smarter transfer time | `TRANSFER_MIN = 1` still constant in the subway planner. (Transfer *topology* was fixed separately — transfers.txt is now authoritative. The LIRR planner computes real schedule-derived transfer times.) |
| PT-308 | P2 | ⬜ | Flexible departure window | Subway `/api/plan` takes only `from`/`to`. The LIRR planner already has depart-at presets — port the pattern. |

### Epic 4 — Mobile-first design

| ID | P | Status | Title | Notes |
|---|---|---|---|---|
| PT-401 | P0 | 🔶 | Touch target audit | FilterPanel, TripPlanner, LirrTripPlanner inputs/buttons are ≥44px (with `fontSize: 16` anti-zoom). Still sub-44: `LineToggle` (~38px effective), `ModeTabs` (36px), plan-tab chips (32px). |
| PT-403 | P1 | ⬜ | Replace `<datalist>` station picker | Both planners still use `<datalist>`; no combobox exists. |
| PT-405 | P1 | ⬜ | iOS safe-area insets | Zero `env(safe-area-inset-*)` usage, and the viewport meta lacks `viewport-fit=cover` (without which insets resolve to 0). Needed for the mobile toggle (`bottom: 16`) and the bottom sheet. |
| PT-406 | P2 | 🔶 | Mobile performance audit | `FRAME_INTERVAL` tuned to 33ms with rationale comment; no captured baseline artifact (`flake-runs/` profiles e2e flakiness, not runtime perf). |

### Epic 5 — Multi-mode (LIRR)

| ID | P | Status | Title | Notes |
|---|---|---|---|---|
| PT-505 | P1 | 🔶 | LIRR-appropriate map styling | Line width/opacity and branch colors shipped. Distinct *marker shape* not: every LIRR route is `markerShape: "circle"` like subway locals — distinctness comes only from the 2-letter branch labels. |
| PT-509 | P2 | ⬜ | LIRR service-alert ribbon | Depends on an alerts feed (PT-306); `LIRR_FEEDS` has no alerts URL. |
| PT-510 | P2 | ⬜ | Cross-mode trip planning | Subway and LIRR planners are fully disjoint; Penn/Jamaica/Atlantic exist only as importance labels, not transfer nodes. Likely its own epic. |

### Superseded

- **PT-508** ("hide planner on LIRR tab") 🔁 — instead of a placeholder, a full
  schedule-based LIRR planner shipped (`LirrTripPlanner.tsx`, `/api/plan/lirr`,
  `lirr-trip-planner.ts`, two ADRs). Leftover: `TripPlanner.tsx` still contains a stale
  "Trip planner is subway-only (PT-508)" comment.
