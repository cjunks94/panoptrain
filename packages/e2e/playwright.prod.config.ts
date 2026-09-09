import { defineConfig } from "@playwright/test";
import { shared, apiServer } from "./playwright.config.js";

/**
 * Production-bundle target (#182).
 *
 * Same suite, same mocked API server, but the browser loads the built
 * client (`packages/client/dist`) served by the server's own static handler
 * on 3001 instead of the Vite dev server on 5173. The dev server papers
 * over bundle-only failures — maplibre 6 resolved its worker fine under
 * Vite's module graph and 404'd in the build — so CI runs both.
 *
 * `pnpm --filter @panoptrain/client build` must run first; globalSetup
 * fails fast with a clear message if dist/index.html is absent, because the
 * server decides whether to serve static files once at startup.
 *
 *   pnpm --filter @panoptrain/e2e test:e2e:prod
 */
export default defineConfig({
  ...shared,
  metadata: { target: "prod" },
  use: {
    ...shared.use,
    baseURL: "http://localhost:3001",
  },
  webServer: [apiServer],
});
