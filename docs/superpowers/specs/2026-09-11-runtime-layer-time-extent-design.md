# Runtime Layer Time Extent — Design

**Date**: 2026-09-11
**Status**: Approved, not yet implemented

## Problem

A time-enabled layer's data time extent — `time.dataStartTime`,
`time.dataEndTime`, `time.interval` and `time.dataDates` — is authored by hand
in the Configure page and baked into the mission config. The coverage gate,
the Timeline and the Layers tool all read it from there. For a growing or
curated collection the config goes stale the moment the data changes: a new
month of data does not show on the timeline, and a layer with data on a
scattered set of dates is requested on days it no longer covers, until someone
edits the config and republishes.

`now` policies cover the simplest growing-collection case (an open end) but
not a start that moves, a cadence that changes, or a sparse list of dates.
That information already lives in the service the layer is served from — a
STAC collection's `extent.temporal`, a `summaries.datetime` list, an item
search — and nothing reads it.

## Goal

A layer's time extent can be read from a JSON endpoint when the mission loads,
so the extent stays current without a config edit. The four static fields keep
working and act as the fallback whenever the endpoint cannot supply a value.
Every consumer of the extent keeps working unchanged.

## Scope

**In scope**: all time-enabled layer types configured through the "Data Time
Extent" section — `tile`, `vector`, `vectortile`, `query` and `velocity`.

**Out of scope**: re-fetching while the app is open; authenticated endpoints
beyond what a plain same-origin `fetch` carries; STAC-specific shortcuts. A
STAC collection is reached through the same generic path mapping as any other
endpoint.

## Decisions taken

- **Source**: a per-layer URL plus four path expressions mapping the response
  to start, end, interval and dates. Any JSON backend works; no response
  contract is imposed on services.
- **Fallback**: static fields are the fallback. A mapped value overrides its
  static field; an unmapped, missing or failed value leaves the static field
  as authored.
- **Timing**: fetched once, while the mission's layers load, before any reader
  sees the layer. No change events, no subscriptions.

## Approaches considered

**Fetch after load and broadcast a change.** Layers register with static
values and the map appears at once; when a fetch resolves the fields are
updated and a `layers:temporalExtentChanged` event tells TimeControl to
re-evaluate coverage and the Timeline to re-read. Rejected: three consumers
gain a subscription and the layer may issue a round of tile requests outside
its real extent during the gap. The startup cost of the chosen approach is
bounded by a timeout and paid concurrently across layers, so it is the smaller
price.

**Prefetch with a short cap, then broadcast late arrivals.** The best user
experience but two code paths to test. Rejected as premature; the broadcast
path is the upgrade if startup latency turns out to matter.

**Full JSONPath via a library.** Filters and recursive descent are more than
the endpoints this is for need, and a dependency is more than a path reader
of a few dozen lines. Rejected; the reader can grow if a real endpoint needs
it.

## Architecture

One new core module, one hook in the layer loader, five config files.

```
Configure page                    Layers_.expandLayers (already async)
  time.extentSource   ──config──▶   for each time-enabled layer with a URL:
    url                              start fetchLayerExtentSource(layer)
    startPath                      await all, before returning
    endPath                                 │
    intervalPath                            ▼ writes into layer.time
    datesPath                     dataStartTime / dataEndTime / interval / dataDates
                                            │
                    unchanged readers ◀─────┘
                    layerTimePolicy · layerDataCoverage · TimeControl
                    layers:getTemporalExtent · Timeline · Layers tool
```

## 1. Configuration

A `time.extentSource` object on the layer config, authored in the Configure
page's "Data Time Extent" section as five text fields:

| Field | Meaning |
| --- | --- |
| `time.extentSource.url` | A URL returning JSON. Fetched with a plain GET when the mission loads. |
| `time.extentSource.startPath` | Path to the earliest data time. Overrides Data Start Time. |
| `time.extentSource.endPath` | Path to the latest data time. Overrides Data End Time. |
| `time.extentSource.intervalPath` | Path to the cadence, an ISO 8601 duration. Overrides Data Time Interval. |
| `time.extentSource.datesPath` | Path to the list of times data exists at. Overrides Data Dates. |

A blank path leaves its static field alone. A blank URL disables the source
entirely, whatever the paths say. The section's existing fields keep their
names; their descriptions gain one sentence saying the value is the fallback
when a runtime source is configured.

Example, a STAC collection:

```
url:          https://stac.example/collections/co2-monthly
startPath:    extent.temporal.interval[0][0]
endPath:      extent.temporal.interval[0][1]
intervalPath: summaries.cadence
datesPath:    summaries.datetime[*]
```

## 2. Path reader

`readPath(json, path)` in the new module returns the value a path names, or
`undefined` when nothing is there. Grammar:

- an optional leading `$` or `$.`, ignored;
- dot-separated object keys: `extent.temporal`;
- `[n]` for an array index, zero-based: `interval[0][1]`;
- `[*]` for every element of an array, flattened one level into the result:
  `features[*].properties.datetime` yields one value per feature.

Anything outside this grammar — filters, recursive descent, quoted keys —
makes the path invalid. An invalid path is reported once with the layer name
and path and treated as matching nothing.

## 3. Normalization

What a path yields is turned into the form the static field holds, so the
existing readers see nothing new.

| Field | Accepted | Applied as |
| --- | --- | --- |
| start, end | a string | as written — the readers already accept ISO datetimes, partial dates and `now` policies |
| start, end | a finite number | epoch milliseconds, written as an ISO datetime |
| interval | a string | as written, an ISO 8601 duration |
| dates | an array of strings and finite numbers | the list, each entry normalized as a start/end value; other entries dropped |
| dates | a lone string or finite number | a one-entry list |

`[*]` on a nested array (`interval[*]` on `[["2020-01-01", null]]`) yields
arrays, which are not accepted for start or end and are dropped for dates.
Null, objects and booleans are never applied. An empty string is a value
that names nothing, so it is not applied either; the static field stays.

## 4. Merge

`applyExtentSource(time, json)` writes onto the layer's `time` object:

- a path that yields an accepted value overwrites its static field;
- a path that is blank, invalid, matches nothing or yields an unaccepted
  value leaves its static field untouched and is reported;
- a response that is not a JSON object or array applies nothing.

Each layer reports at most one warning per outcome, named by layer, so a
mission with a broken endpoint is loud once and quiet after.

## 5. Fetch and hook

`fetchLayerExtentSource(layer, { timeoutMs = 10000, fetchImpl = fetch })`
GETs the URL with an `AbortController`, parses JSON and calls the merge. Any
failure — network, abort, non-2xx, non-JSON — warns once with the layer name
and applies nothing. It never throws and always resolves.

In `Layers_.expandLayers`, beside the STAC prefetch that already runs per
layer: when a walked layer has `time.enabled === true` and a non-blank
`time.extentSource.url`, its fetch is started and the promise collected. The
walk does not wait on it. After `await expandLayers(layers, 0, null)` the
loader awaits all collected promises before continuing. Because the fetch
writes into the same object registered in `L_.layers.data`, every later
reader sees the fetched values on first read, and the fetches run
concurrently so startup waits for the slowest endpoint at most, capped by the
timeout.

## 6. Consumers

Unchanged. `resolveTemporalExtent`, `resolveDataCoverage`, TimeControl's
gate, the `layers:getTemporalExtent` provider, the Timeline and the Layers
tool all read the four static fields, which now hold the fetched values. The
coverage cache in `layerDataCoverage` is keyed on those field values and is
first populated after the fetch, so it is never stale.

## Error handling

No failure in this feature may keep a layer off the map or throw out of the
loader. The worst outcome of a broken source is a layer with its static
extent and one warning in the console.

## Testing

Unit tests in `tests/unit/layerExtentSource.spec.js` (vitest, matching the
neighbouring time-module specs):

- path reader: each grammar form, `$` prefix, `[*]` flattening, an index out
  of range, a missing key, and every rejected form;
- normalization: each accepted and rejected shape per field, including a
  nested array under `[*]` and an empty string;
- merge: override versus fallback per field, a blank path, an invalid path,
  a non-object response;
- fetch: a successful fetch applies values; a timeout, a non-2xx status, a
  network error and a non-JSON body each apply nothing and resolve.

The loader hook is verified by hand: a JSON file served from the app as the
source of one layer, confirming the Timeline and the coverage gate use the
fetched extent, then a deliberately unreachable URL confirming the static
fallback and the single warning.

## Risks

- **Startup latency.** A slow endpoint delays the whole mission load by up to
  the timeout. Mitigated by concurrency and the cap; the broadcast approach is
  the upgrade if it bites.
- **CORS.** The endpoint must allow the app's origin. Nothing here proxies; a
  blocked request is a fetch failure and falls back.
- **Silent override.** A mapped value quietly replaces what the config author
  typed. The field descriptions say so, and the Layers tool's coverage
  popover already shows the extent in effect.

## Files

- New `src/essence/Basics/TimeControl_/layerExtentSource.ts` — `readPath`,
  normalization, `applyExtentSource`, `fetchLayerExtentSource`.
- New `tests/unit/layerExtentSource.spec.js`.
- `src/essence/Basics/Layers_/Layers_.js` — start and await the fetches in
  `expandLayers`.
- `configure/src/metaconfigs/layer-tile-config.json`,
  `layer-vector-config.json`, `layer-vectortile-config.json`,
  `layer-query-config.json`, `layer-velocity-config.json` — the five fields
  and the fallback sentence on the existing four.
