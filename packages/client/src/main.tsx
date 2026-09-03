import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { setWorkerUrl } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import App from "./App.js";

// maplibre-gl 6 is ESM-only and locates its tile worker via import.meta.url,
// which does not resolve inside a Vite production bundle: the URL falls
// through to /assets/maplibre-gl-worker.mjs, the SPA fallback answers with
// index.html, and the module worker dies silently. The style then never
// finishes loading and no tiles or trains render. `?worker&url` routes the
// worker through Vite's worker pipeline so it ships as a self-contained
// chunk (its sibling maplibre-gl-shared.mjs inlined) and we hand maplibre
// that URL once, before any Map is constructed.
// https://maplibre.org/maplibre-gl-js/docs/#installation
setWorkerUrl(maplibreWorkerUrl);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
