import { describe, it, expect } from "vitest";
import { readBodyCapped } from "../capped-body.js";

/** Builds a Response whose body streams `chunkCount` chunks of `chunkSize`
 *  bytes, deliberately WITHOUT a Content-Length header — the case where a
 *  header-only check provides no protection at all. `pulled` records how many
 *  chunks were actually requested, so we can assert the read stopped early
 *  rather than draining the whole body. */
function streamingResponse(chunkCount: number, chunkSize: number) {
  const pulled = { count: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled.count >= chunkCount) {
        controller.close();
        return;
      }
      pulled.count++;
      controller.enqueue(new Uint8Array(chunkSize).fill(7));
    },
    cancel() {
      pulled.cancelled = true;
    },
  });
  return { res: new Response(body), pulled };
}

describe("readBodyCapped", () => {
  it("returns the full body when under the cap", async () => {
    const { res } = streamingResponse(4, 1000);
    const out = await readBodyCapped(res, 10_000);
    expect(out.byteLength).toBe(4000);
    expect(out[0]).toBe(7);
    expect(out[3999]).toBe(7);
  });

  it("rejects an oversized body that has no Content-Length", async () => {
    const { res, pulled } = streamingResponse(1000, 1000); // 1 MB available
    expect(res.headers.get("content-length")).toBeNull();

    await expect(readBodyCapped(res, 10_000)).rejects.toThrow(/exceeded 10000 bytes/);

    // The point of streaming: it must stop early, not buffer all 1000 chunks.
    expect(pulled.count).toBeLessThanOrEqual(12);
    expect(pulled.cancelled).toBe(true);
  });

  it("rejects when the body exceeds the cap by a single byte", async () => {
    const { res } = streamingResponse(1, 1001);
    await expect(readBodyCapped(res, 1000)).rejects.toThrow(/exceeded 1000 bytes/);
  });

  it("accepts a body exactly at the cap", async () => {
    const { res } = streamingResponse(1, 1000);
    const out = await readBodyCapped(res, 1000);
    expect(out.byteLength).toBe(1000);
  });

  it("handles an empty body", async () => {
    const out = await readBodyCapped(new Response(new Uint8Array(0)), 100);
    expect(out.byteLength).toBe(0);
  });

  it("preserves byte order across chunk boundaries", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5]));
        controller.enqueue(new Uint8Array([6]));
        controller.close();
      },
    });
    const out = await readBodyCapped(new Response(body), 100);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("throws when the response has no body", async () => {
    const res = new Response(null, { status: 204 });
    await expect(readBodyCapped(res, 100)).rejects.toThrow(/no body/);
  });
});
