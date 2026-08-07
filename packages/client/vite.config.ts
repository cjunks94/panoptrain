import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Both server and client read POLL_INTERVAL_MS from the repo root .env so
// they can't drift. See README "Roadmap → PT-101".
export default defineConfig(({ mode }) => {
  const rootEnv = loadEnv(mode, resolve(__dirname, "../.."), "");
  const pollInterval = rootEnv.POLL_INTERVAL_MS ?? "30000";

  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: "http://localhost:3001",
          changeOrigin: true,
        },
      },
    },
    define: {
      "import.meta.env.VITE_POLL_INTERVAL_MS": JSON.stringify(pollInterval),
    },
    test: {
      include: ["src/**/*.test.{ts,tsx}"],
      exclude: ["**/node_modules/**", "dist/**"],
      coverage: {
        provider: "v8",
        // Count every source file, not only those a test imports — otherwise
        // the number describes "of the code we test, how much did we cover",
        // which hides the untested React layer entirely.
        all: true,
        include: ["src/**/*.{ts,tsx}"],
        exclude: [
          "src/**/__tests__/**",
          "src/**/*.test.{ts,tsx}",
          "src/main.tsx",
          "src/vite-env.d.ts",
        ],
        reporter: ["text-summary", "lcov"],
        // Ratchet, not target (#144). The workspace standard is 80%; the
        // client sits far below it because hooks/ and components/ have no
        // tests at all — there is no jsdom or testing-library set up. These
        // are pinned just under the measured values so CI enforces
        // "don't regress" now, and are meant to be raised as that gap closes.
        //
        // Measured when set (all: true):
        //   statements 15.51  branches 11.93  functions 14.70  lines 15.60
        thresholds: {
          statements: 15,
          branches: 11,
          functions: 14,
          lines: 15,
        },
      },
    },
  };
});
