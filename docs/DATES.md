# How dates work in MMGIS

Roughly speaking, there are three broad date categories in MMGIS
- time data was originally collected
- time the map controls are set to
- time of the end user

## The three kinds of date

**Acquisition time: when the data was collected.** Every layer's data was collected at some point in the real world, and this collection date can be independent of the map control time slider. Collection dates can be ranges such as 2022-2025, or they can be timestamped instants such as 2025.05.05:15.18.58. In our legend, this is the date we most want to show the user.

**Interface time: where the user put the slider.** The Time Control's state. It is a control input, a request the user is making, not a fact about any data. It matters because it decides what the app asks the tile servers for.

**Export time: when the picture was made.** The wall-clock moment a screenshot or export was produced. It is always true and trivially available.

Layers with periodic data.
- Some layers don't correspond to a single date range or date moment. They contain multiple periods of data which can be accessed independently by requesting the associated time.
- So, you might have a layer that goes from 2022-2025, but in monthly chunks.
- If this layer is *time-enabled* then at any one moment, you aren't seeing 2022-2025, you will only be seeing a single month that corresponds to the cursor location (this level of implementation detail might need to be separated out)


Gotchas:
- A **time-enabled layer** is one whose config has `time.enabled` set. The slider changes what period of data from this layer the map displays.
- A layer that is not time-enabled ignores the slider entirely, but its data still has an acquisition time. This means you can be in a situation where the slider says 2024 while a layer collected in 2016 is still shown on the map.


## Interface time: the Time Control

The Time Control keeps three values, all ISO strings truncated to whole seconds with a trailing `Z`, in `src/essence/Basics/TimeControl_/TimeControl.js`:

| Value | Meaning | Bus request that returns it |
| --- | --- | --- |
| `currentTime` | the cursor, the date the slider handle sits on | `time:getCurrent` |
| `startTime` | the left edge of the slider's window | `time:getStart` |
| `endTime` | the right edge of the slider's window | `time:getEnd` |

Two things about these values are not obvious from the names:

- **The window's right edge is never sent to a server.** Requests run from `startTime` to the cursor, never to `endTime` — or, for a periodic raster layer, cover the one period holding the cursor (see below). Printing "start to end" describes a span the map never requests any API for.
- **The slider has a mode, and in Point mode the window start is a placeholder.** `TimeUI.js` has a Range mode and a Point mode. Switching to Point mode sets the window start to the epoch, 1970, and switching back restores the saved range start. A feature reading `startTime` raw will, in Point mode, print "since 1970." The `time:getMode` bus request says which mode is active: `'range'` or `'point'`, or `null` until time is enabled and seeded and whenever the Time UI bar is not mounted (mobile and the modern layout drive time without it). A feature that prints the window start asks it first, so a genuine window start in 1970 is still told apart from Point mode's placeholder.

Two more bus requests render a time as text, both using the mission's time format (see below): `time:getCurrentFormatted` returns the cursor, or `null` until time is enabled and seeded; `time:formatTime` takes any time the caller holds and formats it the same way, or `null` if it cannot be parsed.

## The two kinds of time-enabled layer

A time-enabled layer has a `time.type`, set by the **Time Type** dropdown on the layer's Configure page. The dropdown offers two values:

- **`requery`**: the layer is re-fetched from its server every time the slider moves, with the current window written into its URL. This is what a tiled raster from STAC or TiTiler is, and what almost every time-enabled layer in a mission is.
- **`local`**: the layer is fetched once and never re-requested for time. It is for a vector layer whose features each carry their own timestamp property; the dashboard hides and shows features on the client by comparing that property to the window. The layer's config names the property in `time.endProp`.

A third value, `global`, appears in older configs. The code treats it exactly as `requery`; Configure no longer offers it.

## How the cursor reaches a layer's tile request

Every time the slider moves, `updateLayersTime` in `TimeControl.js` stamps two fields, `time.start` and `time.end`, on the in-memory copy of every layer with `time.enabled` set. `stampLayerWindow` decides what goes in them, through `layerRequestWindow` in `src/essence/Basics/TimeControl_/layerTimePolicy.ts`:

- **A periodic raster tile layer** is stamped with the one period holding the cursor: `time.start` is the period's start and `time.end` its last inclusive second, so a daily layer with the cursor on 15 June 2025 requests `2025-06-15T00:00:00Z` to `2025-06-15T23:59:59Z`. A layer counts as periodic when it is not `local` and its `time.interval` is an hour or longer, and its periods can be placed: they step from a concrete `dataStartTime`, or, without one, follow UTC calendar boundaries for an interval of exactly `P1Y`, `P1M`, `P1D`, or `PT1H`. The end is the last second rather than the next period's start because STAC `datetime=a/b` intervals are closed at both ends.
- **Every other time-enabled layer** — vectors, `local` layers, layers with no interval or one shorter than an hour, and a periodic layer whose period cannot be placed (the cursor before its `dataStartTime`, say) — is stamped with the Time Control window: `time.start` = `startTime`, `time.end` = `currentTime`, the cursor.

These two fields live only in the running dashboard's layer object. They are not saved to the database, an admin cannot type them (Configure has no Start or End input for a layer's time block), and they are separate from the Data Time Extent fields, which the stamp never touches. A `start` or `end` that shows up in a saved config is stale runtime state that was exported at some point; the dashboard overwrites it on the first slider move.

The window core stamped is also reported back: the `layers:getDataCoverage` bus request carries it per layer as `requestedWindow`, `{ start, end }` in epoch milliseconds, with `periodic` saying whether the period rule applied. What happens next depends on `time.type`:

- A `requery` layer has the window written into its URL and is re-fetched. This is the request the rest of this page is about.
- A `local` layer keeps its URL as authored and is not re-fetched. Its features are filtered on the client against the same window.

`compileTileUrl` in `src/essence/Basics/Layers_/tileUrlUtils.ts` then puts the window into the URL. It does this two ways, and a feature that inspects URLs to guess "does this layer vary with time" has to know both:

- **Placeholders.** `{time}`, `{starttime}`, `{endtime}`, and `{customtime.N}` in the authored URL are replaced with the formatted times.
- **Appended parameters.** For URLs the app builds itself, the authored URL has no placeholder at all. `stac-collection:`, `COG:`, and `titiler-url:` layers get `datetime=start/end` appended; TMS layers get `starttime=` and `time=` appended. These are most of a typical mission's stack, and they vary with the cursor just as much as placeholder URLs do.

The per-layer `time.format` field controls how the times are written into the URL. It uses d3 format specifiers like `%Y-%m-%d` and nothing else.

**What the tile server does with the span is invisible.** A STAC or TiTiler service picks scenes inside the requested span and never reports which ones. So for a time-enabled layer, the true acquisition date of the pixels on screen is not obtainable from the frontend. The most honest date the app can print is the span it requested, labeled as a request — narrowed, where the layer's coverage says so, as the export legend section below describes.

## The mission-wide time format

The Configure page's Time tab has a mission-wide `time.format`. `formatMissionTime` in `TimeControl.js` applies it as d3 time-format specifiers, with `%Y-%m-%dT%H:%M:%SZ` as the default. This is a separate setting from the per-layer `time.format` above: both are named `time.format`, both are d3 specifiers, and they live at different levels of the config.

## Acquisition time: the Data Time Extent fields

The only home for a layer's acquisition range is a pair of fields on the layer in Configure, labeled **Data Time Extent**: `time.dataStartTime` and `time.dataEndTime`. They exist for display and never constrain a query. Each accepts either a concrete datetime or a policy string:

- `now` resolves to the current date at the moment it is read
- `now - P1D`, `now + P5D`, and any other ISO 8601 duration offset from `now`

`temporalExtentFor` in `src/essence/Basics/Layers_/Layers_.js` resolves the policy at call time through `layerTimePolicy.ts`, and the `layers:getTemporalExtent` bus request serves the result for one layer, by UUID or name, or for all layers at once. The Timeline and the Layers panel read it.

Two ways the fields get filled:

- **By hand.** A mission admin types them into the Data Time Extent fields.
- **From a STAC collection.** A layer authored from a STAC collection can have the collection's temporal extent copied into `dataStartTime` and `dataEndTime`, with `dataEndTime: "now"` for an ongoing collection whose STAC extent has no end. Layers authored any other way, including hand-typed STAC, COG, and TiTiler URLs, get nothing automatically, and their acquisition date then exists only as text inside the tile URL, which is not data.

One limit: **resolving `now` discards that it was `now`.** The resolver returns a date. A consumer cannot tell "collection is ongoing" from "collection ended today."

## Period length: `time.interval` and `time.isPeriodic`

A time-enabled layer may carry two more fields in its `time` block: `interval`, an ISO 8601 duration such as `P1D` or `P1M` giving the length of one period, and `isPeriodic`, whether the data repeats on that cadence. A STAC collection reports them as `dashboard:time_interval` and `dashboard:is_periodic`; otherwise a mission author writes them. Nothing reads `isPeriodic`.

Core owns everything the interval does to a request. It decides which layers request one period at a time and what that period is (see above), and it floors a periodic layer's extent end to the last step at or before the resolved end. `layers:getTemporalExtent` returns the interval already parsed, as `interval: { years, months, weeks, days, hours, minutes, seconds }`, or `null` when the layer declares none or it does not parse.

The export legend does no period arithmetic of its own. It reads the parsed interval from `layers:getTemporalExtent` for one thing only: how precisely every date on that layer's row prints.

## Export time

The export legend's header carries it: `new Date().toISOString()`, rendered through `time:formatTime`. Filenames do not — `buildExportFilename` in `shareActions.ts` stamps the filename with `viewState.time`, which is the cursor, not the wall clock.

## What the export legend shows

`getExportLegendModel.ts` in `src/essence/Tools/_shared/legend/` builds the band: a header, then one row for every layer that is toggled on, painting (opacity above zero), and not a header layer. A layer something has filtered out of the panel's lists still paints, so it still gets a row. A layer with no colour ramp and no categorical stops still gets a row, carrying its name and its date line alone.

The header is the mission name, then `Time cursor <time>` — the cursor as `time:getCurrentFormatted` renders it, left out when that returns null — then `Exported <now>` — the wall-clock moment the export was made, printed as the raw ISO string when that moment cannot be formatted.

Each row carries one date line, and every dated line opens with one of two words. **Collected** means the data on screen was gathered inside the range that follows: the app knows the layer's coverage and, for a layer that follows the slider, has narrowed it to what the request could have returned — or, for a periodic layer, to the one period core requested, or, for a layer that lists Data Dates, to the one listed entry the cursor sits in. **Requested** means the app knows only the span it asked the server for. A bare `A → B` never appears, so a range can never be mistaken for a stronger claim than it is. The one undated line is **No data at cursor**, for a time-enabled layer core has hidden because its data does not reach the cursor.

A layer's **coverage** is its Data Time Extent: the two config fields `time.dataStartTime` and `time.dataEndTime`, which an admin typed into the layer's Configure page, the VEDA STAC Source action copied from the STAC collection's temporal extent, or a mission blueprint shipped. Core resolves them into concrete dates for every layer in one `layers:getTemporalExtent` call, turning a `now` policy into today. That is the only statement the app holds about when a layer's data exists; nothing is read from tile responses or URL text. A bound that does not parse is no coverage at all, and the row falls back to what it can say about the request.

A layer that is **not time-enabled** shows its coverage unchanged: `Collected <start> → <end>`, or `Collected from <start>` / `Collected until <end>` for a half-open extent. No coverage means no date line.

For a **time-enabled layer**, `time.enabled` is the whole test. The URL is not inspected: core appends `datetime=` and `starttime=` to URLs that carry no placeholder, so a placeholder test would drop most of a mission's stack. The request the row describes is the window core stamped on the layer, read from that layer's `layers:getDataCoverage` record as `requestedWindow`. When core has no record for the layer, or the record carries no window, the row falls back to the `time.start` and `time.end` stamped on the layer's config, and failing those to the Time Control's `time:getStart` and `time:getCurrent`. In Point mode the Time Control's window start is the epoch placeholder, so the legend asks `time:getMode` once, and when it answers `'point'` the request has no start — unless the record says the layer is `periodic`, whose start is the start of a real period and is kept. Any other answer, `null` included, leaves the start as given. Then:

- **Core decides whether the layer has data at the cursor.** On every time step core's coverage gate tests the layer's request against its declared coverage (its Data Dates when it has them, else its Data Time Extent) — the cursor for a layer requesting the window, the whole period for a periodic one — and, when the request falls outside it, hides the layer and skips its request. The layer stays toggled on, so it keeps its row, but it paints nothing. The export legend reads that verdict from `layers:getDataCoverage`, and when it says `outOfDataRange`, the row reads `No data at cursor` and none of the rules below apply. A layer covering 2015 to 2016 with the cursor on 2024 is such a layer. When core has no verdict for the layer, or the request fails, the rules below decide.
- **A layer that lists Data Dates prints the listed entry the cursor sits in**, whole and at that entry's own precision — `Collected 2025` for a year entry, `Collected 2025-03` for a month, `Collected 2025-03-09` for a day, `Collected 2025-03-09T14:00Z` for an hour — and nothing else about the request or the window. Core's record marks such a layer `kind: 'sparse'` and carries one span per listed entry; the row takes the span containing the cursor (the request's end), and the narrowest one when entries nest. An entry names one unit, so the line is one label, never a range, and neither the chart window nor `time.interval` changes it. Real missions' tile URL templates for such layers request exactly the cursor's day, so the entry the cursor sits in is what is on screen. When the cursor is on no entry, core hides the layer and the row reads `No data at cursor`, per the rule above. A record whose entries miss the cursor although core says the layer has data — a stale one — falls through to the rules below.
- **With coverage, for a layer requesting the window** (`periodic` false or unknown), the row shows the part of the coverage the request could have returned: the overlap of the request span with the coverage. The pixels on screen come from inside the coverage, and the overlap is the part of it the request could reach, whatever mosaic rule the server applied inside it. The line never names a date the layer has no data for. It prints `Collected <start> → <end>`, with the cursor as the end when the coverage runs past it. When neither the request nor the coverage bounds the past — an open request start, which is what Point mode leaves, against a coverage with no start either — the line is `Collected until <end>`, the same half-open wording the not-time-enabled paragraph uses.
- **With coverage, for a periodic layer** (`periodic` true), the row prints the period core requested, whole: `Collected <period start> → <period end>`, both ends at the row's precision. The end is already the period's last inclusive second, so at day precision a one-day period collapses to `Collected 2025-06-15` and a monthly one reads `Collected 2025-05`. The plugin does no arithmetic on it. The only test is whether the period overlaps the coverage at all; when it does not, the row prints `Requested` as below. The period is not clipped to the coverage: core floors a periodic layer's extent end to the last step's start, so clipping would cut the last period down to an instant.

  **Known limit:** core's coverage says only that the period falls inside the layer's extent, not that the server holds a scene for it. A period with no scene renders blank for that layer, yet the row still reads `Collected` for that period, because the coverage said the period was covered.
- **With no coverage**, the row shows the span the map asked for, **Requested** `<window start> → <cursor>`, or `Requested up to <cursor>` when the request has no start: the window start is missing, or `time:getMode` says Point mode.
- **Request and coverage that do not overlap at all** print `Requested`, since the server had nothing inside the span to draw and the app cannot say what, if anything, is on screen. A request that misses the coverage has a cursor outside it, so core's gate normally catches the layer first and the row reads `No data at cursor`; this rule is left for a layer core gave no verdict for.
- Without a cursor, the row shows no date line.

A range whose two ends print as the same label — a single day at day precision, say — shows that label once rather than `X → X`, on a `Collected` line and a `Requested` one alike. A period that is not calendar-aligned prints at its unit's precision and so can read wider than it is: a two-year period starting mid-2025 prints as `2025 → 2027`.

**How precisely a row's dates print** is decided by the layer's `time.interval`, read already parsed from `layers:getTemporalExtent`, not by the mission's time format. A daily collection has no business printing seconds. The smallest unit in the interval sets the precision:

| Smallest unit in `time.interval` | Prints as |
| --- | --- |
| years | `2026` |
| months | `2026-07` |
| days or weeks | `2026-07-03` |
| hours | `2026-07-03T06:00Z` |
| minutes or seconds | `2026-07-03T06:12:22Z` |
| no interval, or unparseable (`interval: null`) | `2026-07-03` |

Every date on a row, whether in a `Collected` or `Requested` line, prints at that precision, and a range prints both ends at it — except the listed entry of a layer with Data Dates, which prints at the entry's own unit, whatever the interval. The two header lines are the exception: the cursor and the export time are instants, not periods, and go through core — the cursor through `time:getCurrentFormatted`, the export time through `time:formatTime` — so they read the way the mission's own Time Control writes them. `renderLegendBand.ts` draws each date line under its row's name, and the header lines under the mission name.

