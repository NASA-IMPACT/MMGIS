# Tracking: migrate legacy tool code off direct Leaflet-layer manipulation

## Motivation

Beyond the raster/tile update flows, a long tail of tool code manipulates Leaflet-native layer objects directly — setting styles, opening popups, reaching into draw internals. Every such call site is invisible to the map-engine adapter boundary, which means: it silently does nothing (or throws) in deck.gl missions, it blocks full engine symmetry, and it couples tools to one engine — the opposite of the decoupled-plugin direction the project is heading.

This is deliberately **not scheduled work** — it's the tracking ticket for the scope carved out of the adapter-owned-updates issue, so the tail is visible instead of forgotten.

## How it should work

Tool code talks to layers through the engine boundary (or through capabilities the engine exposes), never through engine-native objects. A tool that works in a Leaflet mission behaves identically in a deck.gl mission, or explicitly declares the capability it needs.

## Done when

- [ ] An inventory exists of tool call sites that manipulate Leaflet-native layer objects directly, each classified: migrate to an engine call / needs a new engine capability / genuinely Leaflet-only (documented as such).
- [ ] Call sites are migrated or wrapped, tracked as child tasks per tool.
- [ ] No tool silently no-ops in a deck.gl mission due to a Leaflet-object assumption.

## Out of scope

- The raster/tile update flows (opacity, colormap/rescale, time) — handled by the adapter-owned-updates issue this was split from.
- Rewriting tools to the plugin architecture — that's the larger vision-level effort; this ticket only covers the layer-manipulation seam.

<details>
<summary>Notes — written as of 21bf8a4b on 2026-08-05. Starting points only; the inventory is the first real task.</summary>

Known examples of the pattern (not exhaustive):

- `LayersTool.populateCogScale` reads layer internals and detects COG layers by URL prefix.
- `IdentifierTool` branches on URL prefixes and reads layer/raster internals for pixel queries.
- Draw/Measure/vector tools call Leaflet methods (`setStyle`, popups, panes) on registry objects.
- Anything reading `L_.layers.layer[name].options` or calling Leaflet methods on registry entries — grep for `.setStyle(`, `.openPopup(`, `.options` against registry reads to build the inventory.

</details>
