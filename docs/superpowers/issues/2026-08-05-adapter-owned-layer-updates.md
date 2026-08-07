# Route all layer updates through the map-engine adapters — engine-blind callers, adapter-owned instances

## Motivation

Leaflet layers are long-lived objects you mutate in place; deck.gl layers are immutable descriptors you replace. That difference currently leaks out of the engine boundary, and every leak has produced a real bug or a caller-side workaround:

- The opacity slider silently did nothing in deck.gl missions until #266, because shared code assumed a mutable layer object.
- A colormap/rescale change and a time-driven reload each branch per engine (and per renderer) in the calling code, with three different update rituals — one of which was a silent no-op for time-enabled client-side COG layers until recently.
- Because deck.gl replaces instances on every update, each update path must remember to write the new instance back into the global layer registry; forgetting produces stale references that render one thing while the app believes another. #266's fix had to expose this ("the engine may return a replacement instance") to its callers.

The engine adapters exist precisely so callers don't care which engine is active — #212 tracks the same complaint for time reloads. As long as update flows go *around* the adapters, every new capability (a new renderer, a new style knob) re-introduces the same divergence.

## How it should work

Callers never manipulate a live layer object and never branch on the active engine. To change a layer — opacity, visibility, source URL, style parameters, "your config changed, re-render" — calling code asks the engine by layer id, and the engine decides internally whether that means mutating, cloning, or rebuilding.

- The engine is the single owner of live layer instances. Existing code that reads a layer out of the global registry keeps working (the registry read becomes a pass-through to the engine), but nothing caches an instance across an update anymore, so "stale layer object" ceases to be a possible bug.
- The adapters stay layer-type-agnostic: an engine knows how to *carry out* a rebuild, while the module that owns a layer kind supplies *how to build one* — registered at startup, so new layer kinds plug in without touching engine code.
- Both engines expose the same update surface; a capability added for one engine is a compile-visible gap for the other, not a silent difference.

Supersedes the refactor tracked in #212 (close it when this lands). Builds on #266 and the client-side COG renderer stack (#268–#272); should land after both to avoid churn.

## Done when

- [ ] A time change, a colormap/rescale change, and an opacity change each go through one engine call with no engine or renderer branching at the call site — verified by exercising all three in a Leaflet mission and a deck.gl mission with identical results.
- [ ] No calling code writes a layer instance back into a registry after an update; the "engine may return a replacement instance" contract from #266 is gone.
- [ ] Reading a layer out of the global registry after any update returns the currently rendered instance.
- [ ] A new layer kind can register how it is built without modifying adapter code.
- [ ] #212 is closed by this work.

## Out of scope

- Legacy tool code that manipulates Leaflet-native objects directly (popups, styles, draw internals) — tracked in #275; this issue covers raster/tile layer update flows.
- Fully declarative updates (config in, engine reconciles) — a natural phase 3 aligned with the plugin-framework vision, but not needed to fix the inconsistencies above.

<details>
<summary>Draft implementation plan — written as of 21bf8a4b on 2026-08-05. Rough guide; re-verify against latest code.</summary>

### Current behavior

Two registries hold layers: `L_.layers.layer[name]` (global, engine-native objects) and each adapter's internal map (`DeckGLAdapter._layers`, needed for `_syncLayers`). Update flows:

- **Opacity**: `L_.setLayerOpacity` → (post-#266) `IMapEngine.setLayerOpacity`, typed `TLayer | void`; deck returns a clone the caller writes back.
- **Colormap/rescale**: `layers:refresh` handler in `Layers_.js` — deckRaster branch calls `L_.rebuildDeckCOGLayer` (build + registry swap + `engine.addLayer`); Leaflet branch calls the native `tileLayer.refresh()`.
- **Time**: `TimeControl.reloadLayer` branches three ways — Leaflet native `.refresh(url, force, tileOptions)`, deck URL layers `engine.updateLayer({url})` (clone with `data`), deckRaster `L_.rebuildDeckCOGLayer(layer, resolveDeckCOGFileUrl(...))`.
- `IMapEngine.updateLayer` supports only `{opacity, visible, url}`.

### Where the change lands & rough plan

**Phase 1 — `refreshLayer` + builder registration (closes #212):**

1. `IMapEngine`: add `refreshLayer(id, { url?, tileOptions? }): void` and `registerLayerBuilder(kind, (layerObj) => TLayer)`.
2. `LeafletAdapter.refreshLayer` → native `.refresh(url, force, tileOptions)`.
3. `DeckGLAdapter.refreshLayer` → URL-driven layers: internal clone with recompiled URL; built-kind layers (deckRaster): look up the registered builder + layer config, rebuild, replace in `_layers`, `_syncLayers()`. `L_.rebuildDeckCOGLayer` moves into this (delete from `Layers_.js`); the COG module (or `Map_.js` startup) registers `buildDeckCOGLayer` for its kind. URL derivation stays in `resolveDeckCOGFileUrl` — the builder captures it.
   - Relocate `resolveDeckCOGFileUrl` and `shouldUseDeckRaster` from the `Layers_/` tile-source modules into the deck COG builder module in this step. Deliberately deferred to here: today `Layers_.js` imports the deck factory (for `rebuildDeckCOGLayer`), so an adapter-side module importing `tileLayerSource` would close a `Layers_ ↔ Adapters` cycle — step 3 removes that import edge, making the move clean. `shouldUseDeckRaster` also shrinks here to a creation-time kind classification (TimeControl's use disappears with the branch).
4. `TimeControl.reloadLayer` and the `layers:refresh` handler collapse to `Map_.engine.refreshLayer(...)` — no branches. Update `timeControlReloadLayer.spec.js` (assert one engine call) and add adapter-level specs for both `refreshLayer` implementations.

**Phase 2 — single-registry ownership:**

5. Adapter's internal map becomes authoritative; `L_.layers.layer` becomes a getter proxy reading `engine.getLayer(id)` (per user decision: getter, not a new accessor API). Leaflet adapter needs the same internal map discipline first.
6. Remove all write-backs; collapse #266's `setLayerOpacity` return type to `void`.

> ⚠️ Gotcha: adapters must stay layer-type-agnostic — do not special-case COG/deckRaster inside `DeckGLAdapter`. The builder-registration indirection is the point: the engine executes rebuilds, the owning module defines them.

> ⚠️ Gotcha: the getter shim changes `L_.layers.layer` from a plain object to a Proxy/defineProperty structure — code that enumerates it (`Object.keys`, `for…in`) or writes into it directly must keep working during migration; audit writers before flipping (creation paths in `Map_.makeTileLayer` write into it today).

### References

- `src/essence/Basics/MapEngines/IMapEngine.ts` — contract
- `src/essence/Basics/MapEngines/Adapters/DeckGLAdapter.ts` — `_layers`, `updateLayer`, `_syncLayers`
- `src/essence/Basics/Layers_/Layers_.js` — `rebuildDeckCOGLayer`, `layers:refresh` handler
- `src/essence/Basics/TimeControl_/TimeControl.js` — `reloadLayer` branching
- `src/essence/Basics/Layers_/tileLayerSource.js` — `resolveDeckCOGFileUrl`

</details>



