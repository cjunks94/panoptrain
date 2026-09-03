# Panoptrain Backlog

## Enhancements

### Parallel route lines on map
Overlapping routes sharing the same physical track (e.g., 1/2/3 on 7th Ave, B/D/F/M on 6th Ave) should render side-by-side like the official MTA map instead of stacking on top of each other. Use MapLibre `line-offset` paint property with per-route offset values based on trunk group position.

### Airspace overlay v2
v1 shipped (see [docs/ROADMAP.md](docs/ROADMAP.md)) — adsb.lol poller, `/api/airspace/*` with METAR/TAF, smoothed markers, popups, airport directory/briefing, ODbL attribution. Remaining from the original spec, plus deviations worth revisiting: (1) heliport markers from OurAirports — `constants/airports.ts` covers 11 airports, zero heliports, despite Manhattan helicopter traffic being the most interesting layer; (2) airspace shipped as a mutually-exclusive third *mode* tab, not the spec'd independent overlay toggle — co-rendering aircraft above trains would also need the deferred `symbol-sort-key` on the aircraft layer; (3) Class B / TFR polygons (deferred to v2 by design).

### Trip planner times setting — partially shipped (audited 2026-08-12)
Shipped: (a) `<input type="datetime-local">` with ET-offset composition via `lib/etTime.ts`; (c) preset chips (Now / +15 / +30 / +1h / Tom 8am / Pick…); (g) server rejects `at` outside ±7d with explicit-tz-offset requirement, surfaced client-side. Partial: (f) from/to persist under `panoptrain:lirr:lastTrip`, but time-mode/custom value always reset to "now". Still open: (b) depart-at vs arrive-by segmented control (server: new `?mode=arrive-by` path on `/plan/lirr`), (d) `(ET)` suffix on rendered times when client tz ≠ America/New_York (`formatHm` hardcodes the zone silently), (e) surface returned `serviceDate` when the chosen plan crosses a NY calendar boundary (exists server-side, unused by client), (h) widen `DIRECT_LOOKAHEAD_HOURS` from 6 to 12 (or compute dynamically until ≥3 results, capped at 24h). Suggested PR split: A = b, B = d/e + finish f, C = h.

## Performance

### LIRR cold-start hitching — 3 of 4 fixes shipped (audited 2026-08-12)
First open of the LIRR view stuttered because the client-side `snapCache` and `bestShapeCache` (`packages/client/src/lib/trackInterpolation.ts`) start empty — server prewarms its interpolator but the client equivalent didn't exist, so the first poll's ~700 trains hit Turf `nearestPointOnLine` on the main thread. Fixes, in original priority order: (1) ✅ idle-time snap-cache prewarm (`prewarmTrackCaches` via `scheduleIdle`, tested); (2) ✅ `enrichStops` memoized with a `WeakMap`, label formatting done once at load; (3) ✅ `MapLoadingBadge` loading/error/retry pill with a 200ms animation delay so fast loads never flash; (4) ⬜ IndexedDB cache (~7-day TTL) for `/api/{subway,lirr}/{routes,stops}` so returning users skip the multi-MB GeoJSON refetch — caching is still in-memory only (`lib/modeCache.ts`) and dies on reload. RouteId collision risk from the LIRR memory note is verified clean — `colors.ts:71-83` branches on mode, server uses WeakMap keyed by `StaticGtfsData` identity.
