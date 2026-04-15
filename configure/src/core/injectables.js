import { calls } from "./calls";

const injectablesDefaults = {
  TILE_MATRIX_SETS: ["WebMercatorQuad"],
  COLORMAP_NAMES: ["viridis"],
  VELOCITY_COLORMAP_NAMES: ["RDYLBU_R"],
};
// Initialize with reasonable defaults
const injectables = {
  TILE_MATRIX_SETS: injectablesDefaults["TILE_MATRIX_SETS"],
  COLORMAP_NAMES: injectablesDefaults["COLORMAP_NAMES"],
  VELOCITY_COLORMAP_NAMES: injectablesDefaults["VELOCITY_COLORMAP_NAMES"],
};

export const getInjectables = () => {
  getTileMatrixSets();
  getColormapNames("COLORMAP_NAMES");
  getColormapNames("VELOCITY_COLORMAP_NAMES");
};

export const inject = (configJson) => {
  let injected = JSON.stringify(configJson);
  Object.keys(injectables).forEach((inj) => {
    injected = injected.replaceAll(
      `"{{${inj}}}"`,
      Array.isArray(injectables[inj])
        ? JSON.stringify(injectables[inj])
        : injectables[inj]
    );
  });
  return JSON.parse(injected);
};

function getTileMatrixSets() {
  const injectableName = "TILE_MATRIX_SETS";
  if (window.mmgisglobal.WITH_TITILER === "true") {
    calls.api(
      "titiler_tileMatrixSets",
      null,
      (res) => {
        // ... new Set removes duplicates
        injectables[injectableName] = [
          ...new Set(
            injectablesDefaults["TILE_MATRIX_SETS"].concat(
              res.tileMatrixSets.map((s) => s.id)
            )
          ),
        ];
      },
      (res) => {
        console.warn(`Failed to query for ${injectableName}. Using defaults.`);
        injectables[injectableName] = [
          "WebMercatorQuad",
          "CanadianNAD83_LCC",
          "CDB1GlobalGrid",
          "EuropeanETRS89_LAEAQuad",
          "GNOSISGlobalGrid",
          "LINZAntarticaMapTilegrid",
          "NZTM2000Quad",
          "UPSAntarcticWGS84Quad",
          "UPSArcticWGS84Quad",
          "UTM31WGS84Quad",
          "WGS1984Quad",
          "WorldCRS84Quad",
          "WorldMercatorWGS84Quad",
        ];
      }
    );
  }
}

function getColormapNames(injectableName) {
  if (window.mmgisglobal.WITH_TITILER === "true") {
    calls.api(
      "titiler_colormapNames",
      null,
      (res) => {
        // Use all colormaps from TiTiler directly (no filtering)
        let colormaps = res.colorMaps || [];

        // Sort alphabetically
        colormaps.sort();

        // ... new Set removes duplicates
        injectables[injectableName] = [
          ...new Set(
            injectablesDefaults[injectableName].concat(colormaps)
          ),
        ];
      },
      () => {
        console.warn(`Failed to query for ${injectableName}. Using defaults.`);
        // Fallback to common colormap names
        injectables[injectableName] = [
          "viridis", "viridis_r",
          "plasma", "plasma_r",
          "inferno", "inferno_r",
          "magma", "magma_r",
          "cividis", "cividis_r",
          "greys", "greys_r",
          "blues", "blues_r",
          "greens", "greens_r",
          "reds", "reds_r",
          "rdbu", "rdbu_r",
          "spectral", "spectral_r",
          "jet", "jet_r",
          "turbo", "turbo_r",
          "hot", "hot_r",
          "cool", "cool_r",
          "gist_heat", "gist_heat_r",
          "gist_earth", "gist_earth_r",
          "terrain", "terrain_r",
          "ocean", "ocean_r",
          "rainbow", "rainbow_r",
        ].sort();
      }
    );
  } else {
    // Without TiTiler, use a common subset of colormaps
    injectables[injectableName] = [
      "viridis", "viridis_r",
      "plasma", "plasma_r",
      "inferno", "inferno_r",
      "magma", "magma_r",
      "cividis", "cividis_r",
      "greys", "greys_r",
      "blues", "blues_r",
      "greens", "greens_r",
      "reds", "reds_r",
      "rdbu", "rdbu_r",
      "spectral", "spectral_r",
      "jet", "jet_r",
      "turbo", "turbo_r",
      "hot", "hot_r",
      "cool", "cool_r",
      "gist_heat", "gist_heat_r",
      "gist_earth", "gist_earth_r",
      "terrain", "terrain_r",
      "ocean", "ocean_r",
      "rainbow", "rainbow_r",
    ].sort();
  }
}
