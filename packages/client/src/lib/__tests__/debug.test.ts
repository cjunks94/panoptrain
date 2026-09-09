import { describe, it, expect, beforeEach, vi } from "vitest";
import { registerMap, _resetMapForTests, _debugSurface as api, type MapProbe } from "../debug.js";

function fakeMap(layers: Record<string, number>): MapProbe {
  return {
    getLayer: (id) => (id in layers ? { id } : undefined),
    queryRenderedFeatures: vi.fn(({ layers: [id] }) =>
      Array.from({ length: layers[id] ?? 0 }, (_, i) => ({ i })),
    ),
  };
}

describe("window.__panoptrain map probe (#182)", () => {
  beforeEach(() => _resetMapForTests());

  it("reports not ready and null counts before the map registers", () => {
    expect(api.mapReady()).toBe(false);
    expect(api.renderedFeatures("train-markers")).toBeNull();
  });

  it("flips ready once the map's load handler registers it", () => {
    registerMap(fakeMap({}));
    expect(api.mapReady()).toBe(true);
  });

  it("distinguishes a missing layer (null) from an empty one (0)", () => {
    registerMap(fakeMap({ "train-markers": 0 }));
    expect(api.renderedFeatures("train-markers")).toBe(0);
    expect(api.renderedFeatures("train-carets")).toBeNull();
  });

  it("counts the features maplibre reports as rendered for the layer", () => {
    const map = fakeMap({ "train-markers": 26, "aircraft-markers": 3 });
    registerMap(map);
    expect(api.renderedFeatures("train-markers")).toBe(26);
    expect(api.renderedFeatures("aircraft-markers")).toBe(3);
    expect(map.queryRenderedFeatures).toHaveBeenCalledWith({ layers: ["train-markers"] });
  });
});
