# What we can detect about a layer at runtime

Reference for any feature that needs to know "is this layer actually showing something right now?" — export legends, layer lists, auto-zoom, analysis prompts.

## Two different questions

✅ available &nbsp;·&nbsp; ⚠️ available with caveats &nbsp;·&nbsp; ❌ not possible

| Question | Meaning | Cost |
| --- | --- | --- |
| **Presence** | Did the source return data for the area covering the viewport? | Free — already in the render path. |
| **Transparency** | Of the pixels returned, is any actually opaque? | Requires reading pixel alpha. Available for some layer kinds only. |

Most features only need **presence**. Reach for transparency only when "the layer covers this area but every pixel is nodata" has to be distinguished.

## Gating signals — check these before believing anything below

| Signal | What it actually means | Trap |
| --- | --- | --- |
| **Zoom cutoffs** — `L_.enforceVisibilityCutoffs` (`Layers_.js` ~1870) plus per-layer `minZoom` / `maxZoom` / `maxNativeZoom` (`Map_.js` ~1729-1732) | The layer paints nothing outside its zoom range | The most common cause of a blank layer. A layer that is on, fully loaded, and full of data still draws zero pixels here. |
| `L_._layersLoaded[i]` | The layer object was created — and for source-fetched types (vector/query ~1269-1272 and ~1330-1332, velocity ~1619-1620, image ~2320-2328) its source resolved | Never "tiles have painted." On the tile path `addTo(map)` (`Map_.js` ~1747) starts tile requests *before* the flag is set (~1755). |
| `L_.layers.loadStatus[name]` | Some request came back without an error | **Not a presence signal.** deck fires `onTileLoad` even when `getTileData` resolves to `null`, so a layer whose every tile came back empty still reports `status: 'ok'` — and the status latches, never flipping back from `ok` (`Layers_.js` ~2279-2290). |
| **Render settled** | Leaflet has a lifecycle: `loading` / `load` → `L_.setGlobalLoading` / `setGlobalLoaded` (`Map_.js` ~1757-1758, ~1772-1811), consumed via the `L_._globalLoadings` list (`Layers_.js` ~4322-4338) | Wired on the Leaflet tile path only. deck's `onViewportLoad` / `layer.isLoaded` are not wired anywhere (zero hits for `onViewportLoad` in `src/`). Without a settled signal, a not-yet-loaded tile and a genuinely empty one are indistinguishable. |

## deck.gl

`L_.layers.layer[uuid]` holds the layer *descriptor*, not the live rendered instance. Loaded tiles, geometry and images live on the live instance, reachable only through `getNativeMap()` and deck's internal layer manager — that caveat applies to **every** row below, presence included.

| Layer kind | Presence | Transparency |
| --- | --- | --- |
| vector, scatterplot | ⚠️ Exact — geometry is on `props.data`, via internals | — |
| raster tile | ⚠️ Tile content is `null` when there is no data, via internals | ⚠️ Tiles decode to a readable `ImageBitmap`, via internals — and never tainted (see below) |
| COG | ⚠️ Tile either loads or does not, via internals | ⚠️ nodata is discarded on the GPU (`DeckCOGLayer.ts` ~275, ~291), but the raw band `Float32Array` and the nodata sentinel are both in hand in `getTileData` (~196-211), so a CPU-side check is buildable there. The returned `TileData` simply doesn't retain that copy. |
| vectortile | ⚠️ Via internals | ⚠️ Via internals |
| WMS | ⚠️ `onImageLoad` / `onImageLoadError` are wired (`Map_.js` ~1696-1705), but the callback carries only a `requestId` | ⚠️ The decoded image is retained on the live layer's `state.image`, via internals. It is decoded from fetched bytes, so it is not tainted. |

deck raster tiles are fetched with a bare `fetch(url)` (`DeckGLHelpers.ts` ~211). A tile host without `Access-Control-Allow-Origin` therefore fails the fetch outright → `onTileError` → nothing renders. That is also *why* the bitmaps that do survive are never tainted. A 404 or `204 No Content` becomes `null` (`isImageTileResponse`) and nothing is drawn — this is deck-only behavior.

## Leaflet

| Layer kind | Presence | Transparency |
| --- | --- | --- |
| vector, query | ✅ Exact — `getBounds()` measures rendered geometry | — |
| raster tile | ✅ `tileload` / `tileerror` are wired (`Map_.js` ~1760-1770); a 404 fires `tileerror`, not a null tile | ⚠️ Live DOM tiles set no `crossOrigin`, so pixel reads throw for cross-origin hosts. Same-origin tiles — including MMGIS's own — read fine, and re-fetching with CORS works when the host sends `Access-Control-Allow-Origin` (see `IdentifierTool`). |
| data (shader) | ✅ | ✅ MMGIS paints the canvas itself, and its tiles do set `crossOrigin` (`leaflet.tilelayer.gl.js` ~616) |
| image (GeoTIFF), velocity | ✅ | ✅ MMGIS paints these canvases itself |
| vectortile | ✅ | ⚠️ Per-tile SVG only |
| video | ⚠️ The overlay is created, but no `load` / `error` handler is attached (`Map_.js` ~2374-2378), so nothing confirms it played | ⚠️ Non-absolute urls are prefixed onto our own origin (~2339-2342), so the common case is same-origin and untainted; an absolute cross-origin src taints |
| model | ❌ | ❌ Nothing is created on the Leaflet path — globe only |

## `boundingBox`

The mission config's `boundingBox` is author-written metadata and is routinely wrong about what data *exists* — a collection-mosaic tile layer paints wherever the collection has scenes, while its configured bbox often describes a single granule. Never treat it as evidence that data is there.

It is, however, a valid **upper bound on where a layer can paint** — but only on Leaflet, and only for some types:

| Type | Role of `boundingBox` on Leaflet |
| --- | --- |
| tile | Hard tile-request clip via Leaflet's `bounds` option (`Map_.js` ~1648-1658, ~1741) |
| data | Hard clip via `bounds` (~2052-2072) |
| video | **Required**, and it *is* the render extent (~2346-2364) |
| image, vectortile | None — the bbox is parsed but never passed to the layer |

On deck.gl no such clip is applied for any type, so the upper-bound reading does not carry over.

## Screenshots and canvas tainting

`LeafletScreenshot.js` (~73-76) passes both `allowTaint: true` and `useCORS: true` to html2canvas.

- **`useCORS`** is what protects `<img>` tiles: html2canvas re-fetches them itself with `crossOrigin='anonymous'`. The protection is the `crossOrigin` attribute, not the re-fetch. A host that omits `Access-Control-Allow-Origin` fails that load, so the tile is silently **missing** from the capture rather than tainting it.
- **`allowTaint: true`** applies to `<canvas>` and `<video>` elements: html2canvas copies them through with `drawImage` instead of the `getImageData` check that would skip a tainted one. An already-tainted canvas or video therefore taints the export canvas, and `canvas.toBlob` (~104) then throws `SecurityError`.

## Practical ceiling

Detection can be accurate for the common cases and unknowable for others, so the only safe rule is: **act on positive evidence, and fall back to including the layer when there is none.** "Only show what is on screen" cannot be an absolute guarantee.
