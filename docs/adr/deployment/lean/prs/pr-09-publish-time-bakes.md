This is an LLM artifact — a per-PR implementation doc derived from [`./00-overview.md`](./00-overview.md). Draft; verify against current code before acting.

# PR 9 — Static-mode COG range, projection WKT & time-histogram disable

**Depends on:** PR 7 (static-mode `ServiceUrls` + dispatcher). **Blocks:** none.

**Goal:** In static/lean dashboards, source the single-band COG color range from the external TiTiler, compute the shapefile projection WKT in the browser, and disable the (unneeded) time-slider histogram — so none of the three dropped server calls is reached, with no publish-time generation required.

## In plain English

Three small map features used to ask the server a question at the moment they were needed. A grayscale image layer asked "what are the darkest and brightest pixel values?" to stretch a color range; exporting a layer as a shapefile asked "what's this mission's projection definition?" to write the companion file; and the little histogram bars under the time slider asked "how many tiles fall in each slice of time?".

A published dashboard has no server to ask — but none of these three actually needs one:

- The **color range** comes straight from the external tile server (TiTiler) that lean already uses to serve that imagery. TiTiler can report each band's statistics, so the dashboard just asks it directly. No pre-computing, no baking.
- The **projection file** for shapefile export is worked out in the browser with a math library the app already ships.
- The **time-slider histogram** is simply turned off in lean. The team decided it isn't needed, and the time slider itself (scrubbing, animation) keeps working without the decorative bars.

This is much lighter than the original plan, which imagined running heavyweight geo tools at publish time and baking numbers into each dashboard. None of that is needed now — and dropping the histogram also removes the one unsolved question the old plan carried (where the histogram's per-bin counts would have come from once tiles live on external storage).

## Scope / files

This PR is **frontend-only** static-mode call-site edits — there is no publish-time generation step anymore, so it does not touch the publish script.

| File | Change | Disposition | Notes (verified against code) |
|---|---|---|---|
| `src/essence/Basics/Map_/Map_.js` | Single-band COG branch: in static mode, instead of the `calls.getminmax` AJAX, fetch the band's min/max from the layer's external TiTiler (e.g. `<titilerUrl>/cog/statistics?url=<cogUrl>`), with the TiTiler base resolved via `ServiceUrls` (PR 7). Keep the existing prefer-`cogMin`/`cogMax`-from-config path and the `console.warn` fallback. | **Reroute → external TiTiler** | `calls.getminmax` is a **direct `$.ajax`** at ~L2074–2075 inside the `georaster.numberOfRasters === 1` block (~L2064), guarded by `isNaN(parseFloat(layerObj.cogMin/Max))` (~L2069–2070). It bypasses the `calls.js` dispatcher, so this is a call-site edit (the "direct-`$.ajax` bypass" PR 7 flagged). Line numbers are approximate — re-grep `calls.getminmax`. |
| `src/essence/Tools/Layers/LayersTool.js` | Shapefile (`'shp'`) export: compute the WKT from `window.mmgisglobal.customCRS.projString` via `proj4js` (already bundled), falling back to `calls.api('proj42wkt', …)` when the converter returns null; pass it as `shpwrite.zip(…, { prj })`. | **Compute (client-side), GDAL fallback** | Hybrid (review, 2026-06-16): the in-browser converter handles common projections in every mode; the fallback reaches GDAL in full and the converter again in static. `proj4` is already a dependency. |
| `src/essence/Basics/TimeControl_/TimeUI.js` | `_makeHistogram`: in static mode short-circuit to a no-op (and hide `#mmgisTimeUITimelineHisto`) so the `calls.api('query_tileset_times', …)` loop never runs. The rest of the time slider is untouched. | **Drop** | `_makeHistogram` at **L2835**; `calls.api('query_tileset_times', …)` at **L2896–2898** inside `sparklineLayers.forEach`. Senior-dev decision (2026-06-08): the histogram is not needed in lean. |

`src/essence/Tools/Draw/DrawTool_Files.js` also exports shapefiles and got the same hybrid — relevant in full (Draw is kept), moot in lean where **Draw is gated out** (PR 4).

## Implementation steps

1. **COG min/max — `Map_.js` (Reroute to TiTiler).** In the single-band branch, keep preferring `layerObj.cogMin/cogMax` when present (~L2065–2066). When absent in static mode, replace the `calls.getminmax` `$.ajax` (~L2073–2107; re-grep `calls.getminmax`) with a fetch to the layer's external TiTiler statistics endpoint (e.g. `/cog/statistics`), resolving the TiTiler base through `ServiceUrls` (PR 7) and the COG URL from the layer config. Parse the band's min/max from the response into the same `min`/`max` variables. Keep the existing `console.warn` fallback so a failed fetch leaves the layer drawing (range stays NaN) rather than crashing. *(In lean, COG is always served by an external TiTiler, so this source is always available.)*
2. **Projection WKT — `LayersTool.js`/`DrawTool_Files.js` (client compute, GDAL fallback).** In the `'shp'` case, convert `window.mmgisglobal.customCRS.projString` to WKT with `proj4js`; when it returns null, fall back to `calls.api('proj42wkt')` (GDAL in full; the client converter again in static). Pass the result as `shpwrite.zip(…, { prj })`, preserving the existing failure `CursorInfo.update` message so a missing WKT degrades gracefully.
3. **Time histogram — `TimeUI.js` (Drop).** Guard `_makeHistogram` (L2835) to no-op in static mode — return early and hide `#mmgisTimeUITimelineHisto` so the `query_tileset_times` loop (L2896+) never runs. No `times.json`, no baked counts. Verify the rest of `TimeUI` (scrubbing, play/animation) does not depend on the histogram bins.

## Verification

- **COG min/max:** publish a single-band COG mission without `cogMin/cogMax` in its config; confirm the colormap renders with a sensible range, the range was fetched from the external TiTiler (statistics request visible; no `api/utils/getminmax` request), and a TiTiler failure falls back via the existing warn path.
- **WKT:** in a dashboard, export a vector layer as a shapefile; confirm the `.zip` contains a valid `.prj` and no `api/utils/proj42wkt` request fires.
- **Histogram:** in a dashboard, the time slider scrubs/animates normally and shows **no** histogram bars; no `query_tileset_times` request fires; no console errors.
- **Full mode unchanged:** in `node`/`full` mode all three keep today's behavior exactly (the static-mode guards must not alter the server path).

## Rollback

Revert the three static-mode guards. In `full` mode there is zero impact. In `lean`/static mode it degrades to today's behavior: NaN color range falls back via the existing warn path, shapefile export emits no `.prj`, and the histogram simply stays absent — none of which crash the dashboard.

## Implementation notes & gotchas

- **Three dispositions (decided 2026-06-08) — none is a publish-time bake:**
  - **Time histogram → Drop.** Disabled in lean (not needed); no `times.json`, no per-bin count source.
  - **COG min/max → Reroute to the external TiTiler.** Lean always serves COG via an external TiTiler, so the band statistics come from it directly (e.g. `/cog/statistics`) rather than a bake or COG-IFD read.
  - **Projection WKT → client-side compute** via `proj4js`, with a `calls.api('proj42wkt')` GDAL fallback in full mode (review, 2026-06-16).
- **No publish-time generation.** Nothing is baked, so this PR adds no generators to `scripts/publish-static.js` and depends only on **PR 7** (static-mode `ServiceUrls` for the TiTiler URL), not PR 8.
- **`getminmax` is a direct `$.ajax`** (`Map_.js:~2074–2075`), bypassing the `calls.js` dispatcher — so its reroute is a call-site edit, not a `STATIC_HANDLERS` entry. (Same bypass PR 7 flags.)
