# deck.gl-raster Client-Side COG Renderer — Handover

**Purpose:** Land the deferred follow-up cleanup for the client-side COG renderer without rediscovering context.
**Created:** 2026-07-01
**Status:** not started (base feature shipped in PR #172 → split 2026-08-05 into stack #268–#272, merge top-down; `feat/deckgl-raster` remains the combined reference branch)

## Background

- PR **#172** (base `development`, head `feat/deckgl-raster`) adds an optional client-side COG renderer for deck.gl missions via `@developmentseed/deck.gl-raster` / `deck.gl-geotiff`. Implements issue **#158**.
- What shipped: per-layer `cogRendererMode` (`titiler` default / `deckRaster`), single-band float + colormap (colors from `js-colormaps` `evaluate_cmap` for TiTiler parity), NaN nodata → transparent, live colormap/rescale updates with no tile server, and multi-band uint RGB true-color pass-through (pulled forward from the multi-band follow-up).
- No separate tech-debt inventory file — the deferred items are the list below.

## Goal of this cleanup

1. Decouple the colormap **legend swatch** from TiTiler (render it from local `js-colormaps` instead of fetching `/colorMaps`). This is the one residual tile-server request for a deckRaster layer.
2. Optional smoother magnification for single-band float: use **linear** texture filtering when `OES_texture_float_linear` is supported, fall back to nearest.
3. Multi-band RGB path: support **non-8-bit** samples (currently assumes uint8 → `rgba8unorm`).
4. Replace the RGB **black-pixel nodata heuristic** (`FilterBlack`) with the COG's actual mask/alpha where present.
5. Live-verify the two paths currently only unit-tested: **Leaflet fallback render** and **configure-UI field gating**.

**Skip:** band math / false-color composites / band selection — still out of scope (only RGB passthrough was pulled forward). When it *is* in scope, the intended tool is **`MultiCOGLayer`** (`@developmentseed/deck.gl-geotiff`), which takes `sources` (one URL per band slot) plus a `composite` preset and a shared `renderPipeline` — see the library's `sentinel-2` example, which composites B04/B03/B02 that way. Do not extend the single-COG path in `DeckCOGLayer.ts` for this. **Skip:** narrowing `.npmrc` `legacy-peer-deps` — pre-existing `mapbox-gl` vs `maplibre` peer conflict, not caused by this work. *Update 2026-08-05:* `npm install --dry-run --legacy-peer-deps=false` now resolves cleanly — upstream version bumps appear to have dissolved the original ERESOLVE, so the pin may be removable. Removal re-adds ~440 auto-peer packages to the lock (incl. an unused webpack 4 tree) and needs a fresh-install + build + e2e verification pass; if keeping it, reword the `.npmrc` comment from "required" to "keeps unused auto-peer trees out."

**Already fixed on the PR branch (2026-08-03 review, post-base-merge):** time-enabled deckRaster layers now rebuild via `buildDeckCOGLayer` in `TimeControl.reloadLayer` (was a dead `updateLayer({url})`), and `buildDeckCOGLayer` derives `minZoom`/`maxZoom` from the layer config so refresh rebuilds keep zoom clamps.

**Additional small items found in review (fold into this cleanup):**
- ~~`buildDeckCOGLayer` reads `l.cogNoData`, but no Configure field sets it~~ — fixed 2026-08-04: single-band nodata is now read from the COG's own `GDAL_NODATA` tag (`resolveNoDataValue`); `cogNoData` remains a config override with no field yet (add one only if a mission needs to override the file).
- 2-band (gray+alpha) COGs fall into the RGB path without `addAlphaChannel` padding. Less severe since 2026-08-06 — `inferTextureFormat` now returns a real 2-channel format (`rg8unorm`/`rg16unorm`) for them rather than mis-reading the buffer as RGBA — but the render pipeline still treats them as colour, so the alpha band renders as green. Decide whether to route 2-band to the single-band+mask path.

**Upstream API notes (from reading deck.gl-raster's examples, 2026-08-06):**
- `FilterNoDataVal`'s prop is `value`, not `noDataValue` — ours is correct; the library's own `sentinel-2` example passes `noDataValue`, which the module never reads, so that example silently does no nodata filtering. Worth watching on version bumps: a renamed prop fails silently, exactly like the `mipmaps` key did.
- Don't pass `mipLevels` on tile textures: luma.gl's `Texture.defaultProps` already sets `mipLevels: 1` for every format, float included, and their examples omit it. (The original code passed `mipmaps: false`, which is not a TextureProps key at all and was silently ignored — the same silent-no-op class as the `noDataValue` mistake above. Both were caught only by typing the calls against the library's own types.)

## Workspace setup

```bash
cd /Users/sadhikar/repo/IMPACT/MMGIS
git fetch fork
git worktree add -b cleanup/deckgl-raster-followups .worktrees/deckgl-followups fork/development
cd .worktrees/deckgl-followups
npm install   # .npmrc pins legacy-peer-deps
```

To run locally (see `.claude/skills/mmgis-deployment`): `bash .claude/skills/mmgis-deployment/scripts/start.sh .` → open `http://localhost:8889/?mission=<name>` (use 8889 directly; 8888 drops the query string on redirect).

## Commit sequence (plan for the cleanup PR)

### 1. `Render colormap legend swatch from js-colormaps (drop TiTiler /colorMaps fetch)` — now tracked in #296
> Filed as **#296** on 2026-08-11 with a second, related defect found in the same smoke test: a true-colour (multi-band) layer advertises a colormap ramp and editable colormap/min-max controls that its render path ignores entirely. Both are "the legend misrepresents what a client-side COG layer does"; fix them together there rather than here.
- `src/essence/Tools/LayerManager/lib/hooks/useColormapGradient.ts:46` fetches `${baseUrl}/colorMaps/${name}` from TiTiler; `useAvailableColormaps.ts:46` fetches the list. Swatch URL built in `src/essence/Basics/ServiceUrls/ServiceUrls.js:226`.
- Generate the gradient locally with `buildColormapLUT` (`src/essence/Basics/MapEngines/Adapters/colormapLUT.ts`) / `evaluate_cmap`; `configure/src/core/Maker.js` already draws colormap previews from `colormapData`, reuse that approach.
- **Verify:** TBD — load a `deckRaster` mission, DevTools Network filtered to the TiTiler host shows **zero** requests (no `/colorMaps`); legend swatch still matches the render.

### 2. ~~`Use linear float filtering when OES_texture_float_linear is available`~~ — deprioritized
- Reviewed against upstream on 2026-08-06: deck.gl-raster's own float examples (`nldas-icechunk`, `dynamical-zarr-ecmwf`) create `r32float` with `minFilter/magFilter: 'nearest'` and clamp-to-edge, exactly as we do. Nearest is the upstream norm for float, not a limitation we inherited. Only worth doing if blocky magnification is actually reported.

### 3. ~~`Support non-8-bit multi-band COGs`~~ — done 2026-08-06
- The RGB branch now derives its format via `texture.inferTextureFormat` (exported from `@developmentseed/deck.gl-geotiff`) from the file's SamplesPerPixel/BitsPerSample/SampleFormat, instead of hardcoding `rgba8unorm` and coercing with `Uint8Array.from`. Unsigned samples map to `unorm` formats, which the pipeline's unorm `CreateTexture` samples correctly.
- Still open: **band-separate (planar) multi-band**, which throws with a named error. `packBandsToRGBA` exists in `@developmentseed/geotiff` but is **not exported from the package root**, so it can't be imported; the `zarr-sentinel2-tci` example hand-rolls the planar→interleaved loop (~10 lines, alpha 255) — copy that if support is needed.
- **Verify:** a uint16 3-band COG renders in correct colour (not garbled). Not yet exercised live — no uint16 demo COG on hand.

### 4. `Honor COG mask for RGB nodata instead of black-discard`
- `FilterBlack` discards `(0,0,0)`. If `tile.array.mask` is present, upload it and use the `MaskTexture` gpu-module (see how the library's default unorm pipeline builds `maskTexture`).
- **No upstream pattern to copy:** `MaskTexture` appears nowhere in deck.gl-raster's examples (checked 2026-08-06). `zarr-sentinel2-tci` hardcodes alpha 255 and does no nodata masking at all; `sentinel-2` composites single-band COGs and filters with `FilterNoDataVal`. So this is novel work, and lower value than it first looked.
- **Verify:** TBD — a Sentinel TCI tile shows transparent nodata edges via mask; a legitimately-black pixel (deep water) is NOT dropped.

### 5. `Add live checks for Leaflet fallback + configure gating`
- Confirm in a Leaflet mission a `deckRaster`-flagged layer renders via TiTiler (routing gated in `shouldUseDeckRaster`, `src/essence/Basics/Layers_/tileUrlUtils.ts`).
- Confirm the Configure layer modal for a Leaflet mission omits the `cogRendererMode` field (logic in `configure/.../LayerModal/layerFieldVisibility.js`).
- **Verify:** TBD — both confirmed in-browser; note results in the PR.

## Verification

> Post-merge (2026-08-03): upstream replaced the Playwright unit runner with
> vitest, and `cogUrlUtils.ts` was absorbed into `tileUrlUtils.ts` — the
> feature specs moved accordingly.

```bash
# unit suite (feature specs must stay green)
npx vitest run tests/unit/colormapLUT.spec.js tests/unit/cogRendererModeSchema.spec.js \
  tests/unit/layerFieldVisibility.spec.js tests/unit/tileUrlUtils.spec.js \
  tests/unit/composeColormapPipeline.spec.js tests/unit/buildDeckCOGLayer.spec.js \
  tests/unit/timeControlReloadLayer.spec.js tests/unit/LayerManager/handlers.spec.js
# frontend still bundles
npm run build 2>&1 | tail -5
```

## Definition of done

- [ ] Legend swatch renders locally; deckRaster layer makes zero tile-server requests (network panel).
- [ ] Float magnification smooth where supported, nearest fallback intact.
- [ ] Non-8-bit multi-band renders correctly.
- [ ] RGB nodata uses mask where available.
- [ ] Leaflet fallback + configure gating live-verified.
- [ ] Feature unit suite green; build clean.

## Reference commits (already shipped, PR #172, oldest→newest)

- `54adf008` — Add deck.gl-raster deps and bump deck.gl to 9.3
- `0f5ffd3f` — Pin legacy-peer-deps for fresh npm install
- `c493ac8a` — Add colormap LUT generator matching TiTiler colormaps
- `926fd042` — Add cogRendererMode field to COG tab schema
- `0d862d5c` — Hide cogRendererMode in Leaflet missions; extract field-visibility helper
- `e9e97b0c` — Add shouldUseDeckRaster routing helper
- `ea81bf45` — Render COG client-side via ColormappedCOGLayer in deck missions
- `3915d794` — Fix COG renderer: texture leak, stac-collection routing, nodata trigger
- `7b99a915` — Live colormap/rescale updates for deck COG; fix colormap override precedence
- `3fb2bfc2` — Ungate live updates for deckRaster; free colormap texture on layer removal
- `0c24dd6e` — Fix deck COG build: plain super.finalizeState + restore focus-trap-react pruned by dedup
- `28d71cb5` — Render single-band float COGs: custom r32float getTileData + CreateTexture pipeline
- `29dd8d34` — Discard NaN nodata in deck COG render (transparent oceans)
- `d1efd40f` — Add multi-band RGB pass-through for true-color COGs

The last four (`0c24dd6e`, `28d71cb5`, `29dd8d34`, `d1efd40f`) were added during live-demo verification and did **not** go through the per-task code-review loop the earlier commits did — worth an extra read.

## Gotchas

- **Float is not auto-supported by the library.** `@developmentseed/deck.gl-geotiff`'s `inferRenderPipeline` only handles unsigned-int COGs; it throws `non-unsigned integers not yet supported` for float (SampleFormat 3). Our `ColormappedCOGLayer` bypasses it by supplying its own `getTileData`+`renderTile` — providing BOTH makes `COGLayer._parseGeoTIFF` skip the inference. `RENDER_TILE_PLACEHOLDER` (`DeckCOGLayer.ts:187`) exists only to satisfy that guard. The 0.8.0-beta had the same limitation.
- **The `.ts` → `./gpu-modules` subpath import** needs the `@ts-ignore` in `DeckCOGLayer.ts` because tsconfig `moduleResolution: "node"` doesn't read package `exports` maps; Webpack/Node resolve it fine at runtime.
- **Live refresh fallback URL** (`src/essence/Basics/Layers_/Layers_.js:215-216`): the deck rebuild reads `existing.props.geotiff`; the `L_.getUrl(...)` fallback is wrong for a COG (returns a TiTiler template) but is only hit if the live layer/props are missing. Don't rely on it.
- **Nodata is NaN, not a sentinel.** Float COGs use `GDAL_NODATA=nan`; `FilterNoDataVal`'s `==` can't match NaN, hence `FilterNaN` (`color.r != color.r`, `DeckCOGLayer.ts:197`).
- **External COG URLs are proxied** through the app's `/corsproxy/` (range requests forwarded). Direct S3 reads also work when the host sends `Access-Control-Allow-Origin` (both demo COGs do).
- **Demo missions are local DB rows, not in the repo:** `moderndeck` config version 8 (CMIP single-band, `deckRaster`) and mission `tci` (Sentinel-2 true color). Remove with `DELETE FROM configs WHERE mission='tci'; DELETE FROM configs WHERE mission='moderndeck' AND version=8;` (DB `mmgis-stac`, container `mmgis-db-1`, user `user`).

## Files / paths cheat sheet

| Path | Purpose |
|---|---|
| `src/essence/Basics/MapEngines/Adapters/DeckCOGLayer.ts` | `ColormappedCOGLayer` (float+colormap / RGB branch), `cogGetTileData`, `composeColormapPipeline`, `FilterNaN`/`FilterBlack`, `buildDeckCOGLayer` |
| `src/essence/Basics/MapEngines/Adapters/colormapLUT.ts` | LUT from `evaluate_cmap` (TiTiler colormap parity) |
| `src/essence/Basics/Layers_/tileUrlUtils.ts` | `isCogLayer` / `shouldUseDeckRaster` routing; colormap-override precedence in `applyCogFieldsToUrl` (absorbed `cogUrlUtils.ts` in the 2026-08-03 base merge) |
| `src/essence/Basics/Layers_/tileLayerSource.js` | `resolveTileLayerSource` — returns `fileUrl` (bare .tif, pre-TiTiler) used by the deckRaster path |
| `src/essence/Basics/Map_/Map_.js` | `makeTileLayer()` deck branch — routes to `buildDeckCOGLayer` when `shouldUseDeckRaster` |
| `src/essence/Basics/Layers_/Layers_.js` | `layers:refresh` deck-mode rebuild (live updates) |
| `src/essence/Tools/LayerManager/adapters/handlers.ts` | `setColormap`/`setRescale` (ungated for `deckRaster`) |
| `configure/src/metaconfigs/layer-tile-config.json` | `cogRendererMode` field (COG tab) |
| `configure/.../LayerModal/layerFieldVisibility.js` | engine field gating (hides field in Leaflet) |
| `src/essence/Tools/LayerManager/lib/hooks/useColormapGradient.ts` | legend swatch fetch from TiTiler (item 1) |
| `src/essence/Basics/ServiceUrls/ServiceUrls.js` | TiTiler URL builders incl. `/colorMaps` (line 226) |
