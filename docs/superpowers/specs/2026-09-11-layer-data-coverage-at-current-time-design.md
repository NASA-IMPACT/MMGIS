# Layer Data Coverage at the Current Time — Design

**Date**: 2026-09-11
**Status**: Approved, implemented
**Amends**: [2026-09-09-layer-data-coverage-request-gating-design.md](2026-09-09-layer-data-coverage-request-gating-design.md)

## Problem

Core decides whether a time-enabled layer has data by overlapping its declared
coverage with the whole requested window, `[TimeControl.startTime,
TimeControl.currentTime]`. A wide window hides the gaps. The Disasters missions
open on 2012-01-19 → 2026-08-12, which overlaps every layer's coverage, so no
layer is suppressed or reported out of range at startup — although most of
them request only the current instant (`{time}`), where they have nothing.
Scrubbing moves only the window's end, so a layer is reported out of range only
once the instant falls *before* its data; scrubbing past its data never
reports it.

The timeline already treats `dataDates` (falling back to the extent) as where a
layer has data: those are the bars it draws. Core disagrees with its own
timeline whenever the window is wider than an instant.

## Rule

A time-enabled layer has data at the timeline's **current time** and nowhere
else:

1. **Listed times.** When `time.dataDates` yields any readable entry, the layer
   has data when the current time falls inside one of the entries. Each entry
   covers the whole unit it names — year, month, day or hour — inclusive at
   both edges, exactly as the entries resolve today.
2. **Extent.** Otherwise, when `dataStartTime` and/or `dataEndTime` is set, the
   layer has data when the current time falls within `[dataStartTime,
   dataEndTime]`. An empty bound is open; `now` resolves as today.
3. **Nothing declared.** A layer declaring neither is unconstrained: never
   suppressed, never reported out of range.

The window's start plays no part. The current time is `layer.time.end`, which
`updateLayersTime` sets to `TimeControl.currentTime` and `initLayerTimes` seeds
to the initial end.

The rule applies to every time-enabled layer whatever its URL requests. A layer
whose URL asks for a `{starttime}`–`{endtime}` range is suppressed whenever the
current time is not covered, even though a range request might have returned a
mosaic. `dataDates` is the source of truth.

**Returns "has data" whenever it cannot tell**, unchanged: no coverage, no
`time`, or a current time that will not parse.

## Change

### Core — `src/essence/Basics/TimeControl_/layerDataCoverage.js`

`evaluateLayerDataCoverage` computes `outOfDataRange` as "no span contains
`requestedWindow.end`" instead of "no span overlaps `requestedWindow`". The
window-overlap helper is replaced by an instant-containment one.

Nothing else in core changes. Every path that decides visibility — toggling a
layer on, adding one, and each time step in `TimeControl.reloadLayer` — goes
through `assessLayerDataCoverage` → `evaluateLayerDataCoverage`, so request
suppression, `coverageHidden` and `layers:dataCoverageChanged` all follow.
`isSameCoverage` already ignores the requested window.

### Bus record — unchanged

`LayerDataCoverage` keeps its shape. `requestedWindow` stays; its `end` is the
instant the verdict tested, the one a consumer names as the time asked for.
Its documentation in `mmgisAPI.ts` says so.

Renaming the field to a single `requestedTime` was considered and rejected: it
changes the published contract and its consumers for no behavioral gain.

### Bus consumers — no change

A consumer of `layers:getDataCoverage` or `layers:dataCoverageChanged` reads
the verdict as before and needs no change.

### Configure descriptions

`time.dataStartTime`, `time.dataEndTime` and `time.dataDates` in the tile,
vector, vectortile, query and velocity metaconfigs describe the gate in terms
of the timeline's window ("while the timeline's window lies entirely
before/after it", "while the timeline's window touches one of these entries").
Each is reworded in terms of the timeline's current time.

### Prior design

The 2026-09-09 spec's `layerHasDataInWindow` section and its "Wide windows
blunt the optimization" consequence describe window overlap. Both get a note
pointing here.

## Testing

`tests/unit/layerDataCoverage.spec.js` — the verdict cases are rewritten
around the instant:

- a wide window that overlaps coverage but ends outside it is out of range;
- a narrow window that ends inside coverage is in range, whatever its start;
- any time within a listed hour or day is in range, including its first and
  last millisecond;
- the first instant after an entry's unit (midnight after a listed day) is out
  of range;
- a continuous extent: before, inside, after; a lone start bound; a lone end
  bound; `now`;
- unchanged: "has data" whenever it cannot tell.

`timeControlDataCoverageGate.spec.js`, `layersDataCoverage.spec.js` and
`layersToggleLayer.spec.js` are re-read for fixtures whose outcome depends on
overlap and updated where the rule changes it.

## Consequences

- **Startup.** At the Disasters missions' initial time (2026-08-12), 7 of 8
  coverage-declaring layers in DisastersTool and 10 of 11 in
  DisasterUserTesting are suppressed immediately. Only Black Marble
  Nighttime Lights, whose extent reaches 2026-08-12, still requests.
- **Range-requesting layers** are suppressed at uncovered instants, as above.
- **More suppression overall.** Every step off a covered instant now suppresses
  requests, not only steps whose whole window misses coverage.

## Files

| File | Change |
| --- | --- |
| `src/essence/Basics/TimeControl_/layerDataCoverage.js` | Verdict tests the window's end |
| `src/essence/Basics/Layers_/Layers_.js`, `src/essence/Basics/TimeControl_/TimeControl.js` | Comments describe the current-time rule |
| `src/essence/Tools/_shared/adapters/mmgisAPI.ts` | Document `requestedWindow.end` as the tested instant |
| `configure/src/metaconfigs/layer-{tile,vector,vectortile,query,velocity}-config.json` | Reword three field descriptions |
| `docs/superpowers/specs/2026-09-09-layer-data-coverage-request-gating-design.md` | Note the amended rule |
| `tests/unit/layerDataCoverage.spec.js` | Instant-based verdict cases |
| `tests/unit/timeControlDataCoverageGate.spec.js`, `layersDataCoverage.spec.js`, `layersToggleLayer.spec.js` | Fixtures as needed |
