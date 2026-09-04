# How dates work in MMGIS

Three different kinds of date show up in this app, and every date a user sees anywhere (the Timeline, the Layers panel, an exported map) is one of them. They are easy to confuse and the confusion is costly: a reader who sees an unlabeled date on a map assumes it is the date the data was collected, which is the one date the app can least often produce.

This page names the three kinds, then catalogues where each value actually comes from in the code, so a feature that needs to show a date can pick the right one and know its limits.

## The three kinds of date

**Acquisition time: when the data was collected.** Every layer's data was collected at some point in the real world, whether or not the layer responds to the time slider. It is usually a range rather than an instant: a satellite pass, a month of composited scenes, a multi-year campaign. This is the date readers assume a map carries.

**Interface time: where the user put the slider.** The Time Control's state. It is a control input, a request the user is making, not a fact about any data. It matters because it decides what the app asks the tile servers for.

**Export time: when the picture was made.** The wall-clock moment a screenshot or export was produced. It is always true and trivially available, and it is what makes an open-ended date like "to present" readable later.

Two things the vocabulary hides:

- A **time-enabled layer** is one whose config has `time.enabled` set. The slider changes what it shows. A layer that is not time-enabled ignores the slider entirely, but its data still has an acquisition time; the slider can sit on 2024 while a layer collected in 2016 stays on screen.
- For a time-enabled layer, the layer as a whole may cover a long span (say two decades of monthly data) while what is on the map right now is one slice of it. The date worth communicating is the slice, not the span.

## Interface time: the Time Control

The Time Control keeps three values, all ISO strings truncated to whole seconds with a trailing `Z`, in `src/essence/Basics/TimeControl_/TimeControl.js`:

| Value | Meaning | Bus request that returns it |
| --- | --- | --- |
| `currentTime` | the cursor, the date the slider handle sits on | `time:getCurrent` |
| `startTime` | the left edge of the slider's window | `time:getStart` |
| `endTime` | the right edge of the slider's window | `time:getEnd` |

Two things about these values are not obvious from the names:

- **The window's right edge is never sent to a server.** Requests run from `startTime` to the cursor, never to `endTime`. Printing "start to end" describes a span the map never asked for.
- **The slider has a mode that is not on the bus.** `TimeUI.js` has a Range mode and a Point mode. Switching to Point mode sets the window start to the epoch, 1970, and switching back restores the saved range start. A feature reading `startTime` raw will, in Point mode, print "since 1970." Nothing over the bus says which mode is active.

Two more bus requests render a time as text, both using the mission's time format (see below): `time:getCurrentFormatted` returns the cursor, or `null` until time is enabled and seeded; `time:formatTime` takes any time the caller holds and formats it the same way, or `null` if it cannot be parsed.

## How the cursor reaches a layer's tile request

Every time the slider moves, `updateLayersTime` in `TimeControl.js` writes onto every layer with `time.enabled` set:

- `time.start` = the Time Control's `startTime`
- `time.end` = the Time Control's `currentTime`, the cursor

so every time-enabled layer is stamped with the same window, start to cursor. A layer's `time.type` decides what happens next:

- `global` and `requery` layers follow the cursor and are reloaded when it moves.
- `local` layers keep a window of their own in `time.start` and `time.end` and are not restamped.

`compileTileUrl` in `src/essence/Tools/_shared/adapters/tileUrlUtils.ts` then puts the window into the URL. It does this two ways, and a feature that inspects URLs to guess "does this layer vary with time" has to know both:

- **Placeholders.** `{time}`, `{starttime}`, `{endtime}`, and `{customtime.N}` in the authored URL are replaced with the formatted times.
- **Appended parameters.** For URLs the app builds itself, the authored URL has no placeholder at all. `stac-collection:`, `COG:`, and `titiler-url:` layers get `datetime=start/end` appended; TMS layers get `starttime=` and `time=` appended. These are most of a typical mission's stack, and they vary with the cursor just as much as placeholder URLs do.

The per-layer `time.format` field controls how the times are written into the URL. It uses d3 format specifiers like `%Y-%m-%d` and nothing else.

**What the tile server does with the span is invisible.** A STAC or TiTiler service picks scenes inside the requested span and never reports which ones. So for a time-enabled layer, the true acquisition date of the pixels on screen is not obtainable from the frontend. The most honest date the app can print is the span it requested, labeled as a request.

## The mission-wide time format

The Configure page's Time tab has a mission-wide `time.format`. `formatMissionTime` in `TimeControl.js` applies it: if the string contains a `%` it is treated as d3 specifiers, otherwise as moment tokens, and the default is `YYYY-MM-DDTHH:mm:ss[Z]`. This is a separate setting from the per-layer `time.format` above, which is d3 only. Both are named `time.format`; they live at different levels of the config and accept different token languages.

## Acquisition time: the Data Time Extent fields

The only home for a layer's acquisition range is a pair of fields on the layer in Configure, labeled **Data Time Extent**: `time.dataStartTime` and `time.dataEndTime`. They exist for display and never constrain a query. Each accepts either a concrete datetime or a policy string:

- `now` resolves to the current date at the moment it is read
- `now - P1D`, `now + P5D`, and any other ISO 8601 duration offset from `now`

`temporalExtentFor` in `src/essence/Basics/Layers_/Layers_.js` resolves the policy at call time through `layerTimePolicy.ts`, and the `layers:getTemporalExtent` bus request serves the result for one layer, by UUID or name, or for all layers at once. The Timeline and the Layers panel read it.

Two ways the fields get filled:

- **By hand.** A mission admin types them into the Data Time Extent fields.
- **From a VEDA STAC collection.** The tile layer editor's VEDA STAC Source action (`scripts/lib/vedaStacLayer.js`) reads the collection's temporal extent and writes `dataStartTime` and `dataEndTime`. An ongoing collection, one whose STAC extent has no end, gets `dataEndTime: "now"`. Layers authored any other way, including hand-typed STAC, COG, and TiTiler URLs, get nothing automatically, and their acquisition date then exists only as text inside the tile URL, which is not data.

One limit: **resolving `now` discards that it was `now`.** The resolver returns a date. A consumer cannot tell "collection is ongoing" from "collection ended today."

## Period length: `time.interval` and `time.isPeriodic`

A time-enabled layer may carry two more fields in its `time` block: `interval`, an ISO 8601 duration such as `P1D` or `P1M` giving the length of one period, and `isPeriodic`, whether the data repeats on that cadence. The VEDA STAC Source action writes them from the collection's `dashboard:time_interval` and `dashboard:is_periodic`, and nothing else writes them. The export legend reads `interval` for three things: it sets the period the row snaps the cursor to — `2025-06` for a monthly layer — it sets how precisely every date on that row prints, and it is ignored for the `Showing` line when it is shorter than an hour. Nothing reads `isPeriodic`.

## Export time

The export legend's header carries it: `new Date().toISOString()`, rendered through `time:formatTime`. Filenames do not — `buildExportFilename` in `shareActions.ts` stamps the filename with `viewState.time`, which is the cursor, not the wall clock.

## What the export legend shows

`getExportLegendModel.ts` in `src/essence/Tools/_shared/legend/` builds the band: a header, then one row for every layer that is toggled on, painting (opacity above zero), not a header layer, and listed. A layer with no colour ramp and no categorical stops still gets a row, carrying its name and its date line alone.

The header is the mission name, then the cursor as `time:getCurrentFormatted` renders it, left out when that returns null, then `Exported <now>` — the wall-clock moment the export was made, printed as the raw ISO string when that moment cannot be formatted.

Each row carries one date line, and every date line names what kind of date it is, so a bare `A → B` can never be read as an acquisition claim.

For a **time-enabled layer**, `time.enabled` is the whole test. The URL is not inspected: core appends `datetime=` and `starttime=` to URLs that carry no placeholder, so a placeholder test would drop most of a mission's stack. Such a layer's cursor is its own `time.end` when `time.type` is `local`, and the Time Control's `time:getCurrent` otherwise; its window start is its own `time.start`, or `time:getStart`. Then:

- With a usable `time.interval` of an hour or longer, the row shows the period holding the cursor, labelled **Showing**. `P1Y`, `P1M`, and `P1D` are the UTC year, month, or day containing it and print as one value: `Showing 2025-06`. Any other duration is stepped forward from the layer's resolved `dataStartTime` and prints as `Showing <start> → <end>` with the end inclusive, so a P7D period reads `2025-06-01 → 2025-06-07`. When both ends print as the same label — a `PT1H` period at hour precision, say — the row shows that label once rather than `X → X`. A period that is not calendar-aligned still prints at its unit's precision and so can read wider than it is: a two-year period starting mid-2025 prints as `2025 → 2027`. With no `dataStartTime` to anchor on, a cursor sitting before that anchor, an interval shorter than an hour, or an interval that will not parse, the row falls through to the next rule. An interval under an hour is not a period at all but a collection of individually timestamped scenes, so it earns no `Showing` line. The period arithmetic lives in `layerPeriod.ts`, on top of the ISO-duration parsing core owns in `layerTimePolicy.ts`.
- Otherwise the row shows the span the map actually requested, **Requested** `<window start> → <cursor>` — or `Requested up to <cursor>` when the window start is missing or sits within a day of 1970-01-01, which is where Point mode puts it.
- Without a cursor, the row shows no date line.

A layer that is **not time-enabled** shows its Data Time Extent, resolved for every layer in one `layers:getTemporalExtent` call: `Collected <start> → <end>`, or `Collected from <start>` / `Collected until <end>` for a half-open extent. As on the `Showing` line, an extent whose two ends print as the same label — a single day's collection at day precision, say — shows that label once rather than `X → X`. No extent means no date line.

**How precisely a row's dates print** is decided by the layer's `time.interval`, not by the mission's time format. A daily collection has no business printing seconds. The smallest unit in the interval sets the precision:

| Smallest unit in `time.interval` | Prints as |
| --- | --- |
| years | `2026` |
| months | `2026-07` |
| days or weeks | `2026-07-03` |
| hours | `2026-07-03 06:00Z` |
| minutes or seconds | `2026-07-03T06:12:22Z` |
| no interval, or unparseable | `2026-07-03` |

Every date on a row, whether in a `Showing`, `Requested`, or `Collected` line, prints at that precision, and a range prints both ends at it. The two header lines are the exception: the cursor and the export time are instants, not periods, and go through core — the cursor through `time:getCurrentFormatted`, the export time through `time:formatTime` — so they read the way the mission's own Time Control writes them. `renderLegendBand.ts` draws each date line under its row's name, and the header lines under the mission name.
