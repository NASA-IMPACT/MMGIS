import { describe, it, expect, vi, beforeEach } from "vitest";

// Globe_.init loads the 3D engine on demand: a 2D mission must never evaluate
// cesium or lithosphere, and a globe mission must load only the engine it asked
// for. The engine modules are mocked so the factories record whether webpack's
// import() path was taken.
const lithoCtor = vi.fn(function () {
  this.controls = {
    home: {},
    exaggerate: {},
    observe: {},
    walk: {},
    compass: {},
    navigation: {},
    coordinates: {},
    link: {},
  };
  this.projection = { tileXYZ2LatLng: () => ({ lat: 0, lng: 0 }) };
  this._ = {};
  this.options = {};
  this.mouse = {};
  this.addControl = vi.fn(() => ({}));
});
const lithoFactory = vi.fn(async () => ({ default: lithoCtor }));
const cesiumFactory = vi.fn(async () => ({ Viewer: vi.fn() }));
vi.mock("lithosphere", () => lithoFactory());
vi.mock("cesium", () => cesiumFactory());
vi.mock("cesium/Source/Widgets/widgets.css", () => ({}));

const MOCK_METHODS = [
  "addLayer",
  "removeLayer",
  "toggleLayer",
  "hasLayer",
  "getCenter",
  "setCenter",
  "getCameras",
  "setLayerOpacity",
  "setLayerFilterEffect",
  "orderLayers",
  "invalidateSize",
  "setLayerSpecificOptions",
  "getElevationAtLngLat",
];

describe("Globe_.init lazy engine loading", () => {
  let Globe_, GlobeRenderer, L_, F_;
  const RENDERER = "../../src/essence/Basics/Globe_/GlobeRenderer.js";

  async function loadModules() {
    L_ = (await import("../../src/essence/Basics/Layers_/Layers_.js")).default;
    F_ = (await import("../../src/essence/Basics/Formulae_/Formulae_.js"))
      .default;
    L_.configData = { panelSettings: {}, projection: {}, tools: [] };
    L_.FUTURES = {};
    L_.view = [0, 0, 2];
    L_.missionPath = "";
    GlobeRenderer = (await import(RENDERER)).default;
    Globe_ = (await import("../../src/essence/Basics/Globe_/Globe_.js"))
      .default;
  }

  beforeEach(async () => {
    vi.resetModules();
    lithoFactory.mockClear();
    cesiumFactory.mockClear();
    lithoCtor.mockClear();
    document.body.innerHTML =
      '<div id="globe"></div><div id="mouseElev"></div>';
    await loadModules();
  });

  it("2D mission: resolves without loading either engine and litho is a usable mock", async () => {
    L_.hasGlobe = false;
    await Globe_.init();
    expect(lithoFactory).not.toHaveBeenCalled();
    expect(cesiumFactory).not.toHaveBeenCalled();
    expect(lithoCtor).not.toHaveBeenCalled();
    for (const m of MOCK_METHODS)
      expect(typeof Globe_.litho[m]).toBe("function");
    expect(Globe_.litho.options).toEqual({});
    expect(Globe_.litho._).toEqual({});
  });

  it("mock projection.tileXYZ2LatLng inverts the Formulae_ web-mercator tile functions", async () => {
    L_.hasGlobe = false;
    await Globe_.init();
    const cases = [
      [0, 0, 0],
      [-122.4194, 37.7749, 12],
      [151.2093, -33.8688, 7],
      [179.5, 84.9, 3],
    ];
    for (const [lng, lat, z] of cases) {
      const { lat: lat2, lng: lng2 } = Globe_.litho.projection.tileXYZ2LatLng(
        F_.lon2tileUnfloored(lng, z),
        F_.lat2tileUnfloored(lat, z),
        z,
      );
      expect(lng2).toBeCloseTo(lng, 9);
      expect(lat2).toBeCloseTo(lat, 9);
    }
  });

  it("globe mission (lithosphere): loads lithosphere only, constructs renderer", async () => {
    L_.hasGlobe = true;
    await Globe_.init();
    expect(lithoFactory).toHaveBeenCalledTimes(1);
    expect(cesiumFactory).not.toHaveBeenCalled();
    expect(lithoCtor).toHaveBeenCalledTimes(1);
    expect(Globe_.litho.rendererType).toBe("lithosphere");
  });

  it("globe mission (cesium): loads cesium only, constructs renderer", async () => {
    L_.hasGlobe = true;
    L_.configData.panelSettings.globeRenderer = "cesium";
    // Building a real Cesium.Viewer needs WebGL; stop at the engine hand-off.
    const initCesium = vi
      .spyOn(GlobeRenderer.prototype, "_initCesium")
      .mockImplementation(function () {
        this.controls = { link: {} };
      });
    vi.spyOn(GlobeRenderer.prototype, "addControl").mockReturnValue({});
    await Globe_.init();
    expect(cesiumFactory).toHaveBeenCalledTimes(1);
    expect(lithoFactory).not.toHaveBeenCalled();
    expect(initCesium).toHaveBeenCalledTimes(1);
    expect(Globe_.litho.rendererType).toBe("cesium");
  });

  it("globe mission: a failed engine download falls back to the mock instead of rejecting", async () => {
    vi.resetModules();
    vi.doMock(RENDERER, async (importOriginal) => ({
      ...(await importOriginal()),
      loadGlobeEngine: () => Promise.reject(new Error("chunk load failed")),
    }));
    await loadModules();
    L_.hasGlobe = true;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(Globe_.init()).resolves.toBeUndefined();
    expect(L_.hasGlobe).toBe(false);
    expect(lithoCtor).not.toHaveBeenCalled();
    for (const m of MOCK_METHODS)
      expect(typeof Globe_.litho[m]).toBe("function");
    expect(error).toHaveBeenCalled();
    vi.doUnmock(RENDERER);
  });
});
