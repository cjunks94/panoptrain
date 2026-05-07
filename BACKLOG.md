# Panoptrain Backlog

## Enhancements

### Parallel route lines on map
Overlapping routes sharing the same physical track (e.g., 1/2/3 on 7th Ave, B/D/F/M on 6th Ave) should render side-by-side like the official MTA map instead of stacking on top of each other. Use MapLibre `line-offset` paint property with per-route offset values based on trunk group position.

### Improve stop/station visibility
Station dots are currently small gray circles (`circle-radius: 2`, color `#555`) that only appear at zoom 13+. Make stops clearer — consider larger markers, labels at higher zoom levels, transfer station indicators, and/or showing which routes serve each station.

### Airspace overlay above NYC
Add a live aircraft + heliport overlay layered over the existing transit map. v1: poll [adsb.lol](https://adsb.lol) (`/v2/lat/40.75/lon/-73.97/dist/40`) every 5–10s server-side, mirror the GTFS-RT poller pattern under a new `services/airspace-poller.ts` and `routes/airspace.ts`. Ship static heliport markers from OurAirports. Treat as an *overlay*, not a mode — independent toggle outside the subway/LIRR tabs. Defer Class B / TFR polygons to v2 (clutter risk over Manhattan, 3D-on-2D representation problem). Encode altitude via icon scale + popup, not shadow tricks. Required: visible attribution per adsb.lol license, courteous `User-Agent`, `symbol-sort-key` so trains stay readable below zoom 12. Branch: `feature/PT-601-airspace-overlay`.

### Trip planner times setting
The LIRR trip planner has no time-input UI at all — `fetchLirrPlan` accepts an `at` arg but `LirrTripPlanner.tsx:65` always omits it, so the server defaults to `Date.now()`. Add: (a) native `<input type="datetime-local">` + "Now" toggle composing an ET-offset ISO string, (b) depart-at vs arrive-by segmented control (server: new `?mode=arrive-by` path on `/plan/lirr`), (c) quick-preset chips (Now, +15, +30, +1h, Tomorrow 8am), (d) `(ET)` suffix on rendered times when client tz ≠ America/New_York, (e) surface returned `serviceDate` when chosen plan crosses NY calendar boundary, (f) localStorage persistence of last from/to/time-mode, (g) server-side validation rejecting `at` outside ±7d, (h) widen `DIRECT_LOOKAHEAD_HOURS` from 6 to 12 (or compute dynamically until ≥3 results, capped at 24h). Suggested PR split: A = a/c/f/g, B = b, C = d/e, D = h.

## Performance

### LIRR cold-start hitching
First open of the LIRR view stutters because the client-side `snapCache` and `bestShapeCache` (`packages/client/src/lib/trackInterpolation.ts:19-24`) start empty — server prewarms its interpolator but the client equivalent doesn't exist, so the first poll's ~700 trains hit Turf `nearestPointOnLine` on the main thread. Fixes, in priority order: (1) prewarm client snap/bestShape caches with a representative grid sample after `useRouteShapes` resolves; (2) memoize `enrichStops` (`useRouteShapes.ts:50-75`) and defer label formatting — currently re-runs on every mode flip across ~127 LIRR stations; (3) show a skeleton route layer or loading toast while `useRouteShapes.loading === true` (`TransitMap.tsx:569`) — currently a blank map; (4) add IndexedDB cache (~7-day TTL) for `/api/{subway,lirr}/{routes,stops}` so returning users skip the multi-MB GeoJSON refetch. RouteId collision risk from the LIRR memory note is verified clean — `colors.ts:71-83` branches on mode, server uses WeakMap keyed by `StaticGtfsData` identity.
