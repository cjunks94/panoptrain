import { useEffect, useRef, useCallback } from "react";
import type { Aircraft } from "@panoptrain/shared";
import { aircraftKind } from "../lib/aircraftFormat.js";
import { advance, lerpPos, type AircraftSnapshot } from "../lib/aircraftSmoothing.js";

// How long to ease the rendered position from "where we were just drawing"
// to the new truth track when a poll lands. A smaller value snaps faster
// (responsive but jarring); a larger value glides longer (smoother but the
// marker is briefly off-truth). 1.5s absorbs typical 8s-poll prediction
// error invisibly without the lag becoming noticeable.
const SNAP_DURATION_MS = 1500;
// Aircraft drop in and out of ADS-B coverage constantly (line-of-sight,
// transponder cycles, brief ground-station gaps). Don't yank the marker
// off the map on a single missed poll. Keep dead-reckoning at full opacity
// for the grace window, then fade over FADE_DURATION_MS, then unmount.
const FADE_GRACE_MS = 1000;
const FADE_DURATION_MS = 5000;
const FADE_TOTAL_MS = FADE_GRACE_MS + FADE_DURATION_MS;

const EMPTY_FC: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

interface AircraftEntry {
  data: Aircraft;
  /** Position we were drawing at the moment the latest poll arrived. */
  prev: AircraftSnapshot;
  /** Truth from the latest poll. Dead-reckoned forward from `truthTime`. */
  truth: AircraftSnapshot;
  truthTime: number;
  /** Last poll this hex appeared in. Drives fade-out for missed polls. */
  lastSeenAt: number;
}

interface AircraftFeature {
  type: "Feature";
  properties: {
    hex: string;
    track: number;
    kind: string;
    opacity: number;
  };
  geometry: { type: "Point"; coordinates: [number, number] };
}

function snapshotFromAircraft(a: Aircraft): AircraftSnapshot {
  return {
    pos: [a.longitude, a.latitude],
    track: a.track ?? 0,
    speed: a.groundSpeed ?? 0,
  };
}

/**
 * Predictive/corrective smoothing for ADS-B positions.
 *
 * The pattern is the standard one for flight-tracking displays:
 *
 *   1. Dead-reckon — advance each marker by speed*dt along its track every
 *      RAF tick. Smooth motion between polls without holding state on the
 *      server.
 *   2. Snap-back — on a new poll the predicted position has drifted from
 *      the reported truth. Don't jump. Snapshot where we were rendering
 *      and lerp toward the truth track over SNAP_DURATION_MS, then dead-
 *      reckon forward from there.
 *   3. Fade-out — coverage gaps mean planes routinely miss a poll. Keep
 *      dead-reckoning at full opacity for FADE_GRACE_MS, then fade over
 *      FADE_DURATION_MS, then drop. Yank-on-missed-poll looks broken.
 *
 * Yaw smoothing is intentionally omitted — typical poll-to-poll heading
 * deltas are small (<10°) and sudden true heading changes (e.g. turning
 * onto an approach) are correct to render immediately, not gradually.
 */
export function useAircraftFeatures(aircraft: Aircraft[]) {
  const stateRef = useRef(new Map<string, AircraftEntry>());
  const geojsonRef = useRef<GeoJSON.FeatureCollection>(EMPTY_FC);
  // Keyed by hex so feature objects survive across polls — we mutate
  // coordinates in place from the RAF loop, and rebuilding on every poll
  // would otherwise churn MapLibre's identity comparison.
  const featuresByHex = useRef(new Map<string, AircraftFeature>());
  // Forces interpolateFrame to return true on the next call. Needed
  // because a freshly added feature starts at exactly its truth position,
  // so the per-feature change detection sees no diff vs the same coords
  // it just wrote — without this flag the initial setData wouldn't fire
  // and new aircraft would sit invisible until they moved.
  const dirtyRef = useRef(true);

  useEffect(() => {
    const now = Date.now();
    const next = new Map<string, AircraftEntry>();

    for (const a of aircraft) {
      const existing = stateRef.current.get(a.hex);
      let prev: AircraftSnapshot;
      if (existing) {
        // Continuity: the new "prev" is whatever we were drawing the
        // millisecond before this poll landed. Re-run the same lerp the
        // RAF loop would have just run so the snap-back curve picks up
        // exactly where the on-screen position left off.
        const dt = (now - existing.truthTime) / 1000;
        const alpha = Math.min((now - existing.truthTime) / SNAP_DURATION_MS, 1);
        const fromPrev = advance(existing.prev, dt);
        const fromTruth = advance(existing.truth, dt);
        prev = {
          pos: lerpPos(fromPrev, fromTruth, alpha),
          track: existing.truth.track,
          speed: existing.truth.speed,
        };
      } else {
        // First sighting — no on-screen position to preserve. Start at
        // truth so the marker spawns where the data says it is, with no
        // visible snap.
        prev = snapshotFromAircraft(a);
      }
      next.set(a.hex, {
        data: a,
        prev,
        truth: snapshotFromAircraft(a),
        truthTime: now,
        lastSeenAt: now,
      });
    }

    // Carry forward stale entries so they fade out instead of vanishing.
    // Truth + truthTime stay frozen at last sighting so dead-reckoning
    // continues from the last known velocity.
    for (const [hex, st] of stateRef.current) {
      if (next.has(hex)) continue;
      if (now - st.lastSeenAt < FADE_TOTAL_MS) next.set(hex, st);
    }

    stateRef.current = next;

    // Rebuild the feature list, reusing existing feature objects when
    // possible. The RAF loop mutates these in place, so churn = wasted
    // setData work.
    const features: AircraftFeature[] = [];
    const nextByHex = new Map<string, AircraftFeature>();
    for (const [hex, entry] of next) {
      const reused = featuresByHex.current.get(hex);
      const f: AircraftFeature = reused ?? {
        type: "Feature",
        properties: { hex, track: 0, kind: "fixed-wing", opacity: 1 },
        geometry: { type: "Point", coordinates: [entry.prev.pos[0], entry.prev.pos[1]] },
      };
      f.properties.hex = hex;
      f.properties.track = entry.truth.track;
      f.properties.kind = aircraftKind(entry.data.category);
      f.properties.opacity = 1;
      features.push(f);
      nextByHex.set(hex, f);
    }
    featuresByHex.current = nextByHex;
    geojsonRef.current = { type: "FeatureCollection", features };
    dirtyRef.current = true;
  }, [aircraft]);

  const interpolateFrame = useCallback((): boolean => {
    const now = Date.now();
    let changed = false;
    for (const [hex, entry] of stateRef.current) {
      const feature = featuresByHex.current.get(hex);
      if (!feature) continue;
      const dt = (now - entry.truthTime) / 1000;
      const alpha = Math.min((now - entry.truthTime) / SNAP_DURATION_MS, 1);
      const fromPrev = advance(entry.prev, dt);
      const fromTruth = advance(entry.truth, dt);
      const pos = lerpPos(fromPrev, fromTruth, alpha);

      const sinceSeen = now - entry.lastSeenAt;
      const opacity = sinceSeen <= FADE_GRACE_MS
        ? 1
        : Math.max(0, 1 - (sinceSeen - FADE_GRACE_MS) / FADE_DURATION_MS);

      const c = feature.geometry.coordinates;
      if (c[0] !== pos[0] || c[1] !== pos[1]) {
        c[0] = pos[0];
        c[1] = pos[1];
        changed = true;
      }
      if (feature.properties.opacity !== opacity) {
        feature.properties.opacity = opacity;
        changed = true;
      }
    }
    if (dirtyRef.current) {
      dirtyRef.current = false;
      return true;
    }
    return changed;
  }, []);

  return { aircraftGeojsonRef: geojsonRef, interpolateAircraftFrame: interpolateFrame };
}
