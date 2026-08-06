import { describe, it, expect } from "vitest";
import {
  SUBWAY_GTFS_STATIC_URL,
  LIRR_GTFS_STATIC_URL,
  SUBWAY_FEEDS,
  LIRR_FEEDS,
} from "@panoptrain/shared";

/**
 * Guards against reintroducing plaintext HTTP for upstream MTA data (#130).
 *
 * The static archives are unauthenticated and unsigned, and the extracted
 * data is baked into the Docker image and served to every client — TLS is the
 * only thing preventing an on-path attacker on the build network from
 * substituting station and shape data.
 *
 * Note these assert the *scheme only*. They deliberately do not assert the
 * host: MTA may move the S3 bucket, and that should fail loudly at download
 * time rather than silently here.
 */
describe("upstream feed URLs", () => {
  it("downloads static GTFS over HTTPS", () => {
    expect(SUBWAY_GTFS_STATIC_URL.startsWith("https://")).toBe(true);
    expect(LIRR_GTFS_STATIC_URL.startsWith("https://")).toBe(true);
  });

  it("polls every realtime feed over HTTPS", () => {
    for (const feed of [...SUBWAY_FEEDS, ...LIRR_FEEDS]) {
      expect(feed.url.startsWith("https://"), `${feed.id} must use https`).toBe(true);
    }
  });

  it("does not point static GTFS at a known-downgrading redirect", () => {
    // https://web.mta.info/.../subway/google_transit.zip resolves via two
    // hops to http://rrgtfsfeeds.s3.amazonaws.com/gtfs_subway.zip — an https
    // URL that still transfers in the clear. Pin the origin instead.
    for (const url of [SUBWAY_GTFS_STATIC_URL, LIRR_GTFS_STATIC_URL]) {
      expect(url).not.toContain("web.mta.info");
    }
  });
});
