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

Two limits:

- **Nothing fills these fields in automatically.** They are typed by a mission admin. No STAC import writes them, so on most missions they are empty and a layer's acquisition date exists only as text inside its tile URL, which is not data.
- **Resolving `now` discards that it was `now`.** The resolver returns a date. A consumer cannot tell "collection is ongoing" from "collection ended today."

There is no field for a time-enabled layer's period length (monthly, daily). Nothing in the config, the API, or the frontend records it, so a feature cannot snap the cursor to "June 2025" for a monthly layer.

## Export time

Not captured today. `buildExportFilename` in `shareActions.ts` stamps the filename with `viewState.time`, which is the cursor, not the wall clock. The legend band drawn onto exports does not include the export time either.

## What the export legend reads today

`getExportLegendModel.ts` in `src/essence/Tools/_shared/legend/` builds one row per toggled-on layer with legend graphics and, for time-enabled layers, attaches a time range:

- `local` layers: their own `time.start` to `time.end`
- `global` and `requery` layers: the Time Control's `startTime` to `endTime`, the window edges
- layers whose URL has no time placeholder: no range

`renderLegendBand.ts` draws the range under the row's name as a bare "start to end" line.

Held against the sections above, that logic has known limits: it prints the window's right edge, which is never requested; it skips the appended-parameter layers because their URLs carry no placeholder; it shows no range for layers that are not time-enabled even when a Data Time Extent is authored; and a bare range carries no label saying whether it is a request or an acquisition claim.
