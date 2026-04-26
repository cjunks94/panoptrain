import { defineConfig, loadEnv } from "vite";
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
  };
});
