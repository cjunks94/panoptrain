# Upstream fixtures for e2e tests

These are raw bytes captured from the upstream APIs (MTA GTFS-RT and
adsb.lol) at a single moment in time. The server's MSW handlers
(`packages/server/src/test-mocks.ts`, loaded only by `pnpm dev:e2e`)
intercept upstream calls and reply with these files. Tests get
deterministic data, no network latency, and zero upstream dependency.

## Files

| File                  | Source                                                                     |
|-----------------------|----------------------------------------------------------------------------|
| `mta-gtfs.pb`         | `https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs`       |
| `mta-gtfs-ace.pb`     | …`/nyct%2Fgtfs-ace`                                                        |
| `mta-gtfs-bdfm.pb`    | …`/nyct%2Fgtfs-bdfm`                                                       |
| `mta-gtfs-nqrw.pb`    | …`/nyct%2Fgtfs-nqrw`                                                       |
| `mta-gtfs-jz.pb`      | …`/nyct%2Fgtfs-jz`                                                         |
| `mta-gtfs-l.pb`       | …`/nyct%2Fgtfs-l`                                                          |
| `mta-gtfs-g.pb`       | …`/nyct%2Fgtfs-g`                                                          |
| `mta-gtfs-si.pb`      | …`/nyct%2Fgtfs-si`                                                         |
| `mta-gtfs-lirr.pb`    | …`/lirr%2Fgtfs-lirr`                                                       |
| `adsb-aircraft.json`  | `https://api.adsb.lol/v2/lat/40.75/lon/-73.97/dist/40`                     |

## Refresh

GTFS-RT timestamps are frozen-in-time, so the trains route's TTL filter
would normally evict every "stale" vehicle. `index-e2e.ts` works around
this by setting `TRAINS_TTL_S` to effectively infinity for the e2e
server. That means fixture freshness only matters when:

- The upstream schema changes (rare — GTFS-RT is stable).
- You want the test scene (which trains are running, which routes are
  active) to look like the current day rather than the capture day.

Refresh quarterly, or whenever a server-side decoder change touches
GTFS-RT parsing. The capture is a one-shot — run `refresh.sh` from
this directory:

```bash
./refresh.sh
```
