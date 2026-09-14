# Tile URL Pipeline

How a tile layer's raw config URL becomes a fully-substituted request URL, and
where the different rendering engines diverge.

This is the reference for [`tileUrlUtils.ts`](./tileUrlUtils.ts),
[`tileLayerSource.js`](./tileLayerSource.js) and their callers. Read it before
changing time formatting, STAC/COG param injection, or anything that touches
`{time}` / `{customtime.N}` substitution.

> References below name files and functions rather than line numbers, which rot.

## TL;DR

- **`resolveTileLayerSource`** turns a layer config into its base URL. Creation
  and time-driven reload both call it, so they cannot resolve to different
  sources.
- **`buildTileUrlOptions`** formats a tile layer's time values **once**.
  `setLayerWmsParams` writes the same values through the same formatter.
- **`compileTileUrl`** is the pure substituter. It assumes times are
  **already formatted** and never re-formats them.
- **Leaflet** runs `compileTileUrl` **per tile**; **DeckGL** runs it **once**
  and freezes the result. Same code, different cadence — not a bypass.
- **WMS** is the one genuine bypass of `compileTileUrl` (it substitutes in its
  own `getTileUrl`), but it still shares the formatted time values.
- **`startServiceTileFootprint`** is a step alongside the pipeline, not in it:
  for a DeckGL `COG:` / `stac-collection:` layer it reads the service's
  tilejson and narrows **where and at what levels** tiles are asked for. It
  never touches the tile URL.
- The **3D globe** has a **third, separate formatter** that diverges slightly.

## The pipeline in stages

```mermaid
flowchart TD
    A["Raw config URL<br/>COG:… / stac-collection:… / titiler-url:… / plain template"]

    subgraph S1["Stage 1 — Source resolution (tileLayerSource.js)"]
        A --> B["active tile level → L_.getUrl / transformStacUrl<br/>strip prefix, absolutize"]
        B --> C["base layerUrl + splitColonType"]
    end

    subgraph S2["Stage 2 — buildTileUrlOptions (tileUrlUtils.ts)"]
        C --> D["format time strings ONCE (d3 utcFormat)<br/>resolve tms → tileFormat"]
    end

    subgraph S3["Stage 3 — compileTileUrl (tileUrlUtils.ts)"]
        D --> E["replace {time} {starttime} {endtime} {customtime.N}<br/>then inject datetime= / STAC / COG / TMS params"]
    end

    E --> F1["DeckGL: compile ONCE, freeze into layer"]
    E --> F2["Leaflet: compile PER TILE in getTileUrl"]
    D -.shares formatted times, own substitution.-> F3["WMS: substitute in WMSColorFilter.getTileUrl"]
```

### Stage 1 — Source resolution (`resolveTileLayerSource`)

[`tileLayerSource.js`](./tileLayerSource.js). Picks the active tile level's URL
(falling back to `layerObj.url`), runs it through `L_.getUrl`, then branches on
the service prefix:

| Prefix            | What happens                                              |
| ----------------- | --------------------------------------------------------- |
| `stac-collection` | `L_.transformStacUrl(...)`, resolves `tileFormat: 'wmts'` |
| `COG`             | `ServiceUrls.buildTiTilerCogTilesUrl(...)`                |
| `titiler-url`     | strip prefix, absolutize against `L_.missionPath`         |
| plain template    | falls through untouched                                   |

Output: a real base `url`, the `splitColonType` (the stripped prefix, which
`compileTileUrl` later keys off of), the tile level's `tileElevation`, and the
resolved `tileFormat` (forced to `wmts` for `stac-collection` sources).

> The resolver is **pure**. The `layerObj.tileformat` write for stac layers is
> a separate step — `syncTileFormatToConfig`, called at creation — for the
> readers that consume the config directly (globe setup, IdentifierTool). The
> pipeline itself threads `tileFormat` through `buildTileUrlOptions` and never
> reads that write.

> **Both** `Map_.makeTileLayer` and `TimeControl.reloadLayer` call this. They
> used to each carry their own copy of the logic, and the reload copy silently
> dropped the tile-level selection — a time change would swap the layer back to
> its default source. Keep this single implementation.

> **Note:** `makeTileLayer` calls `TimeControl.performTimeUrlReplacements(...)`
> before the engine branch. Despite the name, it does **not** substitute the
> `{time}` / `{starttime}` / `{endtime}` family into the tile template — that is
> Stage 3's job alone. It does two unrelated things:
>
> 1. **Custom variable URL replacements** — for layers configured with
>    `layer.variables.urlReplacements` where `on === 'timeChange'`. It `fetch`es
>    an **external API** and substitutes a user-defined `{key}` placeholder with
>    the response value. The `{starttime}` / `{endtime}` formatting here is
>    applied only to the **fetch request body**, not to the tile URL.
> 2. **Cache-busting** — appends `nocache=<timestamp>` when
>    `forceRequery === true`.
>
> At creation it's called with `forceRequery = null`, so for a plain tile layer
> with no `variables.urlReplacements` it's effectively a pass-through. It is
> **not** part of the `buildTileUrlOptions` / `compileTileUrl` pair — don't
> confuse it for Stage 3.

### Stage 2 — Option building (`buildTileUrlOptions`)

[`tileUrlUtils.ts`](./tileUrlUtils.ts). Formats the time strings **once** via
`formatLayerTime` (d3 `utcFormat`, empty string on unparseable input), takes the
`tileFormat` resolved in Stage 1 (falling back to `resolveTileFormat` on the
layer config), and captures the global STAC mosaic limits from
`mmgisglobal.options.stac` — the one environmental read in the pipeline, kept
here so `compileTileUrl` stays a closed function of its arguments. Both engines
call this.

`TimeControl.setLayerWmsParams` writes `options.time` / `.starttime` / `.endtime`
directly onto an existing Leaflet layer rather than going through
`buildTileUrlOptions`, but it uses the same `formatLayerTime`, so the values
agree.

> **Invariant:** the time strings on the returned object are **already
> formatted**. `compileTileUrl` substitutes them verbatim and never re-formats.

> **Invariant:** the result is a **closed set** of tile-URL keys — nothing from
> the layer config is spread in. See "closed key set" below.

### Stage 3 — Substitution (`compileTileUrl`)

[`tileUrlUtils.ts`](./tileUrlUtils.ts). The pure substituter, in order:

1. `{time}` / `{starttime}` / `{endtime}` and `{customtime.N}` replacement
2. STAC/COG/titiler `datetime=` injection, STAC `exitwhenfull` / `skipcovered`,
   COG params via `applyCogFieldsToUrl`, the STAC mosaic limits captured by
   `buildTileUrlOptions` (never read from globals here)
3. TMS `starttime` / `time` / `composite` params

**The URL template's own params win.** Every injection step skips a param the
template already spells out — `datetime` here, the COG params in
`applyCogFieldsToUrl`, `starttime` / `time` / `composite` in the TMS step. A
layer whose url configures its own window, e.g.
`?datetime={time}T00:00:00Z/{time}T23:59:59Z`, keeps exactly that: appending a
second `datetime` would leave two on the request, and a server that resolves a
repeated scalar to the last value would use the injected range instead of the
configured one.

**Step 1 must stay ahead of step 2.** `applyCogFieldsToUrl` round-trips the
whole query string through `URLSearchParams`, which percent-encodes braces —
`{time}` becomes `%7Btime%7D` and no longer matches the replacement. Leaflet
masks this for the three standard tokens (`L.Util.template` substitutes them
from `this.options` before `compileTileUrl` is reached); DeckGL has no such
step, so with the old ordering a placeholder inside a query string reached the
server raw.

Time placeholders are always replaced, even when the value is `''` (no time
configured, or times not yet resolved): `https://t/{time}.png` becomes
`https://t/.png`, not a literal `{time}` the tile server would reject. The
substitution reads the layer's URL template each time, so an emptied URL is
never sticky — the next compile with real times fills them in.

## Stage 4 (DeckGL only) — the service's footprint (`startServiceTileFootprint`)

[`serviceTileFootprint.js`](./serviceTileFootprint.js). Stages 1–3 settle **what
URL** a tile is fetched from. This settles **which tiles are fetched at all**,
and only on DeckGL: a Leaflet layer takes its `bounds` from the config
`boundingBox` at construction, but the DeckGL build carries no footprint, so the
layer asks for tiles across the whole viewport at every zoom.

`Map_.makeTileLayer` does not start it. It hands back what its layer's service
can be asked, and `makeLayer` calls `startServiceTileFootprint` after
`handOffToEngine` — the footprint is applied to the layer *the engine holds*,
and the engine does not hold it before the hand-off. That call is made for every
build, with a footprint source or without: a rebuild that leaves the layer with
no service to ask still has to drop what the last build learned. It is made for
the **main map only** — `Map_.engine` is always the main map's, so the Animation
tool's offscreen rebuild of the same layer name describes a layer it is not
holding. The layer is built and counted as loaded by then, and the call is
**not** awaited: a slow tile service must not hold up `allLayersLoaded`. It
derives a tilejson URL from the same resolved source Stage 1 produced — through
the same `ServiceUrls` getter the tile URLs resolve through for a prefixed
source, and out of the address itself for a layer configured with one in full:

| Source                       | Tilejson read                                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| `COG`                        | `{titiler}/cog/WebMercatorQuad/tilejson.json?url=<encoded .tif url>`                                      |
| `stac-collection`            | `{titilerpgstac}/collections/<id>/WebMercatorQuad/tilejson.json?assets=asset`                             |
| full collection tile address | `<base>/collections/<id>/WebMercatorQuad/tilejson.json?assets=asset`, base and id read out of the address |
| `titiler-url`                | none — an opaque endpoint with no derivable tilejson path                                                 |
| other plain template         | none — a plain template of another shape, a basemap or a WMS among them                                   |
| deck raster `COG`            | none — the layer reads the `.tif` itself and requests no tiles                                            |

A layer configured with a collection mosaic's tile address in full —
`<base>/collections/<id>/tiles/WebMercatorQuad/{z}/{x}/{y}`, optionally with an
`@Nx` scale suffix and a format extension — is read that last way, taking its
service from the address rather than from `ServiceUrls`: the author typed the
service that serves the tiles, and that is the one that can say what they cover.
A static build with no services configured gets a footprint for the same reason.
Nothing else of the address is carried. Its query string holds the colormap,
asset, rescale and nodata the tiles are drawn with, none of which change the
bounds reported, and the address is read before Stage 2 substitutes its
placeholders, so a time-enabled layer's still spells out
`datetime={starttime}/{endtime}` — which the service answers 500 for, an answer
then remembered for the life of the page. `assets=asset` is the literal the
`stac-collection` row sends, a base resolved through `ServiceUrls` already
arrives without its trailing slash, and one left in a typed-out address comes
off where the address is read, so the two ways of configuring one collection
name the same URL and share a single request.

**The tilejson path carries no `/tiles/` segment** where the tile path does.
`/collections/<id>/tiles/WebMercatorQuad/tilejson.json` is answered 200
`text/html` with the STAC Browser page rather than 404, so deriving one path
from the other by substitution fails only as a JSON parse error, which is then
remembered under that URL for the life of the page.

An address pinning one item — `/collections/<id>/items/<item>/tiles/…` — is not
read, nor is one whose placeholders run `{z}/{y}/{x}`, nor one still carrying a
`{...}` anywhere before them. The tile matrix set is read from the address for
this form, since these layers set no `tileMatrixSet` in config. None of it
changes a tile URL: a prefix-less source never reaches `compileTileUrl`'s COG
branch or `applyCogFieldsToUrl`, so the layer requests exactly the URLs it
requested before, and every edge-cache key with them.

Only `WebMercatorQuad` is asked, the same `tileMatrixSet || 'WebMercatorQuad'`
rule the tile URLs use: DeckGL indexes WebMercator tiles only. A null getter —
a static build with no service configured — makes no request either. Neither
does a URL whose time placeholders have not resolved: a `{time}` that compiled
to nothing, or a `{customtime.N}` still sitting in the URL, names a file no
service can answer for, and the answer would be remembered under that URL for
the life of the page.

What comes back becomes two deck.gl tile props, applied to the layer the
engine already holds via `updateLayer`'s `tileFootprint`:

- **`extent`** from `bounds`, clamped to ±180 / ±90 rather than refused, since
  TiTiler routinely reports `-180.0000001` and ±85.0511. Bounds still spanning
  the globe after clamping are treated as none reported — titiler-pgstac reports
  the world box for any collection whose `extent.spatial.bbox` is the world.
- **`maxZoom`** from `maxzoom`, replacing the ceiling the config
  `maxNativeZoom` / `maxZoom` set at build. `minzoom: 0` with `maxzoom: 24`
  counts as no zooms reported — that is the matrix set's own range, which
  titiler-pgstac returns for every collection.

**The service's `minzoom` is deliberately not passed on.** Alongside an
`extent`, DeckGL reads `minZoom` as "raise every request to this level" across
the whole of that extent ∩ viewport: a continental COG reporting a floor of 8
would ask for hundreds of level-8 tiles at world zoom where the unbounded layer
asked for a handful. TiTiler serves the levels below a COG's own floor from its
overviews, and titiler-pgstac never reports a real one. The config `minZoom`
keeps its own meaning untouched — the zoom the layer appears at, reaching DeckGL
as `visibleMinZoom` (see `tileZoomProps`).

One request per tilejson URL per page, successes and failures alike, so layers sharing a COG or a collection and the rebuilds a tile-level switch triggers reuse it. A failure — network error, the 10 s timeout, a non-2xx, an unusable body — leaves the layer exactly as built and warns once per layer, each in its own name, since the layers reusing a remembered failure would otherwise fail silently. Every apply first drops whatever footprint the layer had, so a rebuild onto a source with no tilejson does not leave zoom-to-layer answering with the old one, and takes a token that a read settling out of order is checked against, so a slow first build cannot land its answer on a second build's layer. A footprint is remembered only once the engine is known to hold the layer. A time change reaches the layer as `layer.clone({ data })` (`deckTileRefresher.js`), which carries these props forward, so a time-templated `COG:` series keeps its build-time footprint.

`layerBoundsFor` prefers a fetched footprint over the config `boundingBox`, so
zoom-to-layer works for a COG or STAC layer with no box configured. What is
remembered lives outside `L_.layers` and is keyed by layer name, so every way a
layer can leave the map has to say so, or the next layer to take that name
inherits its footprint: `L_.removeLayerFromLayersData` calls
`forgetServiceTileFootprint` for the one layer, `L_.clear` calls
`forgetAllServiceTileFootprints` for the whole set a mission swap replaces, and
`makeLayer`'s `catch` forgets a layer whose rebuild threw before the apply.
Each drops the build token alongside the footprint, so a read still in flight
is discarded with it.

## The three call sites

| Engine      | Cadence              | Creation                  | Time-change                             |
| ----------- | -------------------- | ------------------------- | --------------------------------------- |
| **DeckGL**  | compile **once**     | `Map_.makeTileLayer`      | rebuild URL + `Map_.engine.updateLayer` |
| **Leaflet** | compile **per tile** | `Map_.makeTileLayer`      | `tileLayer.refresh(...)`                |
| **WMS**     | own substitution     | `L.tileLayer.colorFilter` | reads shared `this.options` times       |

### DeckGL — resolves once, eagerly

Deck needs a complete static URL upfront (no per-tile hook), so `compileTileUrl`
runs a single time at layer creation and the baked URL is frozen into the deck
layer. On a time change `TimeControl.reloadLayer` rebuilds the URL and calls
`Map_.engine.updateLayer`.

### Leaflet ColorFilter — resolves lazily, per tile

`buildTileUrlOptions` output is spread into `this.options` at creation, but
`compileTileUrl` runs inside `getTileUrl` —
[`leaflet-tilelayer-middleware.js`](./leaflet-tilelayer-middleware.js) — once
per tile fetch, **after** Leaflet has already substituted `{z}/{x}/{y}`. On a
time change, `refresh(newUrl, force, updateOptions)` merges new values into
`this.options` and `this._url`; the next `getTileUrl` per tile picks them up.

#### `refresh()` re-applies the creation-time URL normalization

`L.tileLayer.colorFilter` does two things to a URL that a plain assignment to
`_url` would skip, so `refresh()` repeats them:

- **`{t}`** — a documented shorthand time placeholder. `L.Util.template` throws
  on any `{token}` it can't resolve from options, so `normalizeTileUrlTemplate`
  rewrites it to an inert `_time_` first. A `_url` carrying a raw `{t}` throws
  on every subsequent tile fetch.
- **the WMS base/params split** — a WMS layer keeps only the base address in
  `_url`; the query params live in `wmsParams` and are re-appended per tile.
  `wmsExtension.refresh` re-splits an incoming URL rather than assigning it
  whole, which would send every param twice. The split is **merge-only**:
  params in the incoming URL are added or overwritten, but a param the URL no
  longer carries is not removed from `wmsParams` and keeps being sent.

### Why `buildTileUrlOptions` returns a closed key set

`refresh()` copies **every** key it is handed onto `this.options`, and
`this.options` also holds Leaflet's own creation options — several of which are
not plain copies of the layer config: `bounds` is an `L.latLngBounds` built from
`boundingBox`, `tms` comes from the resolved tile format rather than
`layerObj.tms`, `minZoom`/`maxZoom`/`maxNativeZoom` are `parseInt`'d, and
`continuousWorld`/`reuseTiles` are constants. So `buildTileUrlOptions` returns
only the keys `compileTileUrl` reads and never spreads the layer config — that is
what lets both creation and `refresh()` take the object whole. **Add a new
tile-URL option there and nowhere else**; both paths then pick it up.

### `TimeControl.reloadLayer` — the time-change entry point

[`../TimeControl_/TimeControl.js`](../TimeControl_/TimeControl.js). Re-runs
`resolveTileLayerSource` and `buildTileUrlOptions`, then dispatches: Leaflet via
`tileLayer.refresh(...)`, Deck via `compileTileUrl` + `updateLayer`. The Deck
branch does not return early — both branches fall through to a shared tail that
restores `layer.url` to the pre-substitution original.

> Deck and Leaflet run **identical** code, differing only in cadence
> (frozen-once vs per-tile). This is by design, not a bypass.

## The one genuine bypass: WMS

`L.tileLayer.colorFilter`: if `tileFormat === 'wms'` it constructs a
`WMSColorFilter`. That class's `getTileUrl` does its own `{time}` /
`{starttime}` / `{endtime}` / `{customtime.N}` substitution against
`this.wmsParams` and **never calls `compileTileUrl`** — a parallel substitution
path. It also replaces only the **first** occurrence of each of the three
standard tokens per param (non-global `String.replace`), where `compileTileUrl`
replaces all.

It is **not fully divorced**, though: it still reads `this.options.time` /
`.starttime` / `.endtime`, which came from `buildTileUrlOptions` at creation. So
the **formatted time values are shared** — only the substitution mechanism is
duplicated. A WMS layer won't get out of sync on time formatting; it just won't
pick up `compileTileUrl`'s STAC/COG/TMS param logic — which is correct, WMS
doesn't want those.

## The third formatter: the 3D globe

The globe path [`../Globe_/GlobeRenderer.js`](../Globe_/GlobeRenderer.js) has
its own `d3.utcFormat` block. **Known divergence:** it **re-formats
`customTimes`** — `timeFormat(Date.parse(customTimes.times[i]))`. The
`tileUrlUtils` path does not — `buildTileUrlOptions` passes `customTimes`
through raw and `compileTileUrl` substitutes them verbatim. So `{customtime.N}`
gets d3-formatted on the globe but injected as-is on Leaflet/Deck. This is a
tracked follow-up ("third formatter"), separate from the `tileUrlUtils` flow.

## Invariant: format once, substitute verbatim

Time values are formatted exactly once, in `buildTileUrlOptions`.
`compileTileUrl` is a **pure substituter** — it injects the already-formatted
strings and never parses or re-formats them. This is a design guarantee, not a
fix for a past bug: Leaflet calls `compileTileUrl` per tile, so if formatting
lived there it would re-bite on every tile fetch and shift dates across
timezones, while DeckGL's single URL bake would hide it. **Do not introduce
formatting into `compileTileUrl`.**
