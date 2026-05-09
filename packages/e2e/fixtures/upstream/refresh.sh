#!/usr/bin/env bash
# Refresh the upstream fixture captures. Run from this directory or via
# `bash packages/e2e/fixtures/upstream/refresh.sh`. Hits the real
# upstreams once each in parallel — needs network connectivity.
set -euo pipefail
cd "$(dirname "$0")"

MTA="https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds"
ADSB="https://api.adsb.lol/v2/lat/40.75/lon/-73.97/dist/40"
TIMEOUT=15

# Track each background PID so we can wait on them individually and fail
# loudly if any download errors. Bare `wait` masks failures and would
# silently leave us with stale fixtures.
pids=()
curl -sf -o mta-gtfs.pb        "$MTA/nyct%2Fgtfs"        --max-time "$TIMEOUT" & pids+=($!)
curl -sf -o mta-gtfs-ace.pb    "$MTA/nyct%2Fgtfs-ace"    --max-time "$TIMEOUT" & pids+=($!)
curl -sf -o mta-gtfs-bdfm.pb   "$MTA/nyct%2Fgtfs-bdfm"   --max-time "$TIMEOUT" & pids+=($!)
curl -sf -o mta-gtfs-nqrw.pb   "$MTA/nyct%2Fgtfs-nqrw"   --max-time "$TIMEOUT" & pids+=($!)
curl -sf -o mta-gtfs-jz.pb     "$MTA/nyct%2Fgtfs-jz"     --max-time "$TIMEOUT" & pids+=($!)
curl -sf -o mta-gtfs-l.pb      "$MTA/nyct%2Fgtfs-l"      --max-time "$TIMEOUT" & pids+=($!)
curl -sf -o mta-gtfs-g.pb      "$MTA/nyct%2Fgtfs-g"      --max-time "$TIMEOUT" & pids+=($!)
curl -sf -o mta-gtfs-si.pb     "$MTA/nyct%2Fgtfs-si"     --max-time "$TIMEOUT" & pids+=($!)
curl -sf -o mta-gtfs-lirr.pb   "$MTA/lirr%2Fgtfs-lirr"   --max-time "$TIMEOUT" & pids+=($!)
curl -sf -o adsb-aircraft.json "$ADSB"                   --max-time "$TIMEOUT" & pids+=($!)

failed=0
for pid in "${pids[@]}"; do
  wait "$pid" || failed=1
done
(( failed == 0 )) || { echo "one or more downloads failed" >&2; exit 1; }

ls -la *.pb *.json
