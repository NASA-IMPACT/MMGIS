# deck.gl TiTiler tiles render maplibre's glyph atlas on layer update

**Purpose:** Land the fix for TiTiler `tile` layers painting maplibre's font atlas (red glyphs on black) after an update, without re-deriving the mechanism.
**Created:** 2026-08-06
**Status:** not started — root cause traced, top candidate identified, not yet reproduced under instrumentation.
**Branch observed on:** `feat/deckgl-raster`

## Symptom

- On **update layer** (opacity change, time reload, URL refresh) a deck.gl `tile` layer stops showing imagery and instead paints a grid of red-on-black glyphs over the layer's bbox — one full glyph sheet per tile.
- Glyphs are the accented Latin set for the *currently visible* basemap labels (e.g. `á í ó ú ç` over Brazil/Uruguay). That identifies the texture as **maplibre's SDF glyph atlas**, not deck.gl's `TextLayer` font atlas.
- Not the `deckRaster` / `deck.gl-raster` COG path. This is `TileLayer` → `BitmapLayer` with TiTiler tiles (`buildDeckLayer` `'tile'` branch).

## Mechanism (traced, not yet runtime-confirmed)

1. **Shared GL context.** `DeckGLAdapter.ts:1241` sets `interleaved: true` on the `MapboxOverlay`. deck.gl draws inside maplibre's WebGL context, so a sampler with a dead binding reads whatever maplibre left bound to the unit rather than rendering black.
2. **The atlas is single-channel (R8).** Sampling it into a `vec4` yields `(r, 0, 0, 1)` → red glyphs on black. One atlas per tile because each `BitmapLayer` mesh spans uv 0..1.
3. **`image` is truthy but deleted.** `BitmapLayer.draw()` guards with `if (image && model)` (`node_modules/@deck.gl/layers/dist/bitmap-layer/bitmap-layer.js:152`). A destroyed `Texture` object is still truthy, passes the guard, and binds a dead GL handle.
4. **Texture ownership is keyed by layer id string.** `@deck.gl/core/dist/dist.dev.js:38920-38958`:
   ```js
   internalTextures[texture.id] = owner;              // owner === component.id
   if (internalTextures[texture.id] === owner) { texture.delete() }
   ```
   With the `image` async prop's transform/release pair at `dist.dev.js:39039-39053`. TileLayer sublayer ids (`${layerId}-${tile.id}`) are identical across rebuilds, so a finalizing old sublayer deletes a texture the same-id new sublayer still holds via `ASYNC_RESOLVED`. This only fires on an update cycle — never on first load, which matches the symptom.

## Top candidate cause

`src/essence/Basics/MapEngines/Adapters/DeckGLHelpers.ts:203-208` deviates from deck.gl's documented `renderSubLayers` form:

```ts
return new BitmapLayer({
    ...(props as object),
    data: undefined,
    image: props.data as string,
    bounds,
} as ConstructorParameters<typeof BitmapLayer>[0])
```

- Spreading `...props` reads every prop **through its getter**. For async props that returns the *resolved* value, so the `Texture` is re-supplied as a literal prop instead of staying deck's own resolved async value — losing the original/resolved distinction deck uses to decide reuse-vs-recreate on layer match.
- `data: undefined` is not `data: null`. `undefined` reads as "not provided" in deck's prop merge, so it does not reliably clear tile content off `data`.

Aggravating factor: `DeckGLAdapter.updateLayer` (`:859-871`) does `existing.clone({data: options.url})`. Changing a `TileLayer`'s `data` invalidates the whole tileset, so every sublayer finalizes and rematches at once — all visible tiles fail together.

## Commit sequence

### 1. `Use deck.gl's two-argument BitmapLayer form in renderSubLayers`

- `DeckGLHelpers.ts:193-209` — replace the spread form with the documented constructor:
  ```ts
  return new BitmapLayer(props as any, {
      data: null,
      image: props.data,
      bounds,
  } as any)
  ```
- Keep the existing `tileElevation` bbox/bounds derivation unchanged.
- **Verify:** TBD — load a deck mission with a TiTiler `tile` layer, change its opacity via the Layers tool, then run a time reload. Imagery persists through both; no glyph grid. Repeat while zoomed so 8+ tiles are live (the failure needs several sublayers rematching at once).

### 2. `Guard BitmapLayer draw against a destroyed image texture` *(only if #1 does not fix it)*

- Subclass `BitmapLayer` in `DeckGLHelpers.ts` and return early when `this.props.image?.destroyed` is true, so a dead binding renders nothing instead of maplibre's atlas.
- **Verify:** TBD — with instrumentation from "Diagnostics" below, a layer whose `image.destroyed === true` draws nothing rather than glyphs.

## Diagnostics

Confirm the texture-death theory before/while fixing — this is the single check that separates "destroyed texture" from "wrong theory":

```js
// in a BitmapLayer draw override, or from the console against a live sublayer
console.log(bitmapLayer.props.image?.destroyed, bitmapLayer.props.image?.id)
```

`destroyed: true` on a layer that is still drawing confirms it. If `destroyed` is `false`, the release/ownership reading is wrong and the investigation restarts at the binding level (`model.shaderInputs.getBindingValues()`).

## Ruled out

- **deck.gl `TextLayer` / `FontAtlasManager`.** No `TextLayer` anywhere in `src/`. The engine is `MapboxOverlay` + `maplibre-gl` (`DeckGLAdapter.ts:28-29`); the glyphs match visible basemap labels.
- **The `deck.gl-raster` / `deckRaster` COG path.** Different layer stack entirely (`COGLayer` → `RasterTileLayer` → `RasterLayer` → `MeshTextureLayer`). Not involved in this report; do not re-trace it.
- **Layer id mismatch between initial build and rebuild.** `Map_.js:1545` uses `layerObj.name`, `Layers_.js:421` uses `L_.asLayerUUID(layerObj.name)` — but `L_.layers.data` is keyed by name (`Layers_.js:4091`), so `asLayerUUID` returns the name unchanged and deck does diff in place.
- **`props.data` being null.** `BitmapLayer.draw()` already guards on falsy `image`; a null tile renders nothing, not glyphs.

## Definition of done

- [ ] Opacity change on a TiTiler `tile` layer keeps imagery, zoomed in far enough for 8+ live tiles.
- [ ] Time reload on the same layer keeps imagery.
- [ ] `bitmapLayer.props.image.destroyed` is `false` for every drawing sublayer after an update.
- [ ] No regression on the `deckRaster` path (`docs/DECKGL_RASTER_COG_HANDOVER.md` verification block still green).
- [ ] `npm run build` clean.

## Gotchas

- **Interleaved mode hides the failure mode.** Without `interleaved: true` a dead binding reads black and looks like "tile didn't load". Any fix must be verified *in* interleaved mode — that is where the atlas leaks in, and it is the only mode MMGIS ships (`DeckGLAdapter.ts:1241`).
- **First load never reproduces this.** The texture delete only happens when an old sublayer finalizes. Always reproduce via an update, not a fresh page load.
- **`internalTextures` ownership is a module-global keyed by id string** (`dist.dev.js:38919`), not by object identity. Two layers sharing an id share ownership — that is the whole bug class.
- The two-arg `new BitmapLayer(props, overrides)` form is not sugar; it is what deck's sublayer prop machinery expects. Do not "simplify" it back to a spread.

## Files / paths cheat sheet

| Path | Purpose |
|---|---|
| `src/essence/Basics/MapEngines/Adapters/DeckGLHelpers.ts:186-211` | `buildDeckLayer` `'tile'` branch — `TileLayer` + `renderSubLayers` → `BitmapLayer` |
| `src/essence/Basics/MapEngines/Adapters/DeckGLAdapter.ts:859-871` | `updateLayer` — clones the layer with new `opacity`/`visible`/`data` |
| `src/essence/Basics/MapEngines/Adapters/DeckGLAdapter.ts:1241` | `interleaved: true` on the `MapboxOverlay` |
| `src/essence/Basics/MapEngines/Adapters/DeckGLAdapter.ts:1304-1315` | `_syncLayers` — hands deck a fresh layers array |
| `node_modules/@deck.gl/layers/dist/bitmap-layer/bitmap-layer.js:143-162` | `BitmapLayer.draw` and the `if (image && model)` guard |
| `node_modules/@deck.gl/core/dist/dist.dev.js:38920-38958` | `createTexture` / `destroyTexture` and the `internalTextures` ownership map |
| `node_modules/@deck.gl/core/dist/dist.dev.js:39039-39053` | `image` async prop `transform` / `release` |
