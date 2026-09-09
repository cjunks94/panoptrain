import { Hono } from "hono";
import type { Mode } from "@panoptrain/shared";

// Stub — implemented in the green commit for #143. Mirrors the pre-fix
// inline handler so the red tests fail on behaviour, not on a missing module.
export function createHealthRouter(_opts: { required: Mode[] }): Hono {
  const health = new Hono();
  health.get("/", (c) => c.json({ status: "ok", uptime: process.uptime() }));
  return health;
}
