import { describe, it, expect, afterEach, vi } from "vitest";
import { z } from "zod";

/**
 * fetchJson contract tests (#86). The function is the single place where
 * server responses cross into the client; a Zod schema is required and a
 * mismatch surfaces as a typed error instead of silently passing bad
 * data downstream.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("fetchJson", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return parsed data when response matches the schema", async () => {
    const schema = z.object({ id: z.string(), n: z.number() });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ id: "abc", n: 1 }));
    const { fetchJson } = await import("../api.js");

    const result = await fetchJson("/thing", schema);

    expect(result).toEqual({ id: "abc", n: 1 });
  });

  it("should throw a schema-mismatch error when the response shape is wrong", async () => {
    const schema = z.object({ id: z.string(), n: z.number() });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ id: "abc", n: "not-a-number" }));
    const { fetchJson } = await import("../api.js");

    await expect(fetchJson("/thing", schema)).rejects.toThrow(/Schema mismatch for \/thing/);
  });

  it("should throw a schema-mismatch error when required fields are missing", async () => {
    const schema = z.object({ id: z.string(), n: z.number() });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ id: "abc" }));
    const { fetchJson } = await import("../api.js");

    await expect(fetchJson("/thing", schema)).rejects.toThrow(/Schema mismatch/);
  });

  it("should preserve the legacy `API <status>: <body>` error format on non-ok responses (503 cold-start path depends on it)", async () => {
    const schema = z.object({});
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("poller not ready", { status: 503 }));
    const { fetchJson } = await import("../api.js");

    await expect(fetchJson("/thing", schema)).rejects.toThrow(/^API 503: poller not ready/);
  });

  it("should strip unknown fields per Zod default (lenient on upstream additions)", async () => {
    const schema = z.object({ id: z.string() });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(jsonResponse({ id: "abc", extraField: "ignore me" }));
    const { fetchJson } = await import("../api.js");

    const result = await fetchJson("/thing", schema);

    expect(result).toEqual({ id: "abc" });
  });
});
