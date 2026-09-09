# Layer Data Coverage Request Gating — Design

**Date**: 2026-09-09
**Status**: Approved, not yet implemented

## Problem

A time-enabled layer requests tiles for every instant the timeline visits,
including instants its data does not cover. A layer configured with data on
twelve days of 2020 still issues a full viewport of tile requests on every one
of the other 354 days, and every one of them comes back empty, 404, or as a
transparent tile. The cost is paid per tile, per layer, per time step.

The layer configs already declare their coverage — `time.dataStartTime`,
`time.dataEndTime` and `time.dataDates` — but nothing reads them at request
time. The Configure UI currently describes them as "for display purposes only
and does not constrain queries", and the timeline is their only consumer.

## Goal

A time-enabled layer that declares data coverage issues **no requests** while
the time window sits outside that coverage, on either map engine, whether it
was switched on before, during, or after the window moved out. When the window
moves back into coverage the layer returns, current.

A layer that declares no coverage keeps today's behavior exactly.

## Scope

**In scope**: all time-enabled layer types — `tile`, `vectortile`, `vector`,
`query`, `velocity`, and the deck.gl equivalents — on both the Leaflet and
DeckGL engines.

**Out of scope**: the 3D globe. `L_.toggleLayerHelper` adds tile and model
layers to LithoSphere (`L_.Globe_.litho.addLayer`) through a registry that sits
outside the map-engine abstraction, so the single visibility lever this design
turns on does not reach it. Gating the globe means a second, parallel
implementation against `litho.toggleLayer`; it is deliberately left for later.

## Decisions taken

| Decision | Choice | Why |
| --- | --- | --- |
| Rollout | Always on, no new opt-in flag | A layer declaring coverage it does not have is a config bug, not a mode. An opt-in switch most users never find would leave the optimization off in practice. The field descriptions are rewritten to match. |
| Layer types | All time-enabled types | The gate sits above the type switch, so covering everything costs no more than covering tiles, and a vector requery is often the single most expensive request of the lot. |
| User signal | Warning icon with a hover popover; no dimming | The row stays legible. A suppressed layer needs to be distinguishable from a broken one, and the popover can say *why* — which a dimmed row cannot. |

## Approaches considered

**A. Layer-level visibility gate — chosen.** One coverage check at the
time-change choke point; an out-of-coverage layer is taken off the map.
Leaflet's `setLayerVisibility(false)` removes the layer from the map, and the
DeckGL adapter's `_syncLayers` already filters `visible === false` out of the
array handed to deck, so deck finalizes the tileset and stops fetching. One
lever, verified against both adapters, and it covers the non-tile paths for
free.

> This last point needed checking rather than assuming: deck.gl's `TileLayer`
> has no `visible` guard of its own — `updateState` runs `_updateTileset`
> regardless, and `CompositeLayer._renderLayers` does not short-circuit on
> `visible` either. An invisible deck tile layer that deck still holds *would*
> keep fetching. It is the MMGIS adapter's `_syncLayers` filter, not deck,
> that makes hiding stop the requests.

**B. Per-tile URL suppression.** Return `L.Util.emptyImageUrl` from Leaflet's
`getTileUrl` and `null` from deck's `getTileData`. Rejected: it edits two
engine-specific hot paths, still builds tile DOM and tileset bookkeeping, and
does nothing for a vector requery.

**C. Collapse the layer's spatial extent** when out of coverage. Rejected:
expresses a temporal condition through a spatial prop, and leaves the layer's
real bounds unrecoverable.

## Architecture

Four units, each independently testable:

1. **`layerDataCoverage.js`** — pure. Config in, spans out. No DOM, no engine,
   no `L_`.
2. **The gate** — three call sites that ask (1) a yes/no question and act.
3. **The state record** — one registry on `L_` and one bus event.
4. **The UI signal** — LayersTool reads the bus event; it never computes
   coverage itself.

The dependency runs one way: UI reads state, state is written by the gate, the
gate calls the pure module. Nothing reads back.

## 1. Coverage model

New file: `src/essence/Basics/TimeControl_/layerDataCoverage.js`.

```js
resolveDataCoverage(time) -> null | Array<{ start: number, end: number }>
```

Epoch milliseconds. `null` means **unconstrained** — the layer places no
temporal limit on its requests, and every downstream check treats it as always
having data.

Resolution rules, in order:

| Condition | Result |
| --- | --- |
| `time.enabled !== true` | `null` |
| `time.dataDates` yields ≥ 1 readable ISO day | one span per day, `[00:00:00.000Z .. 23:59:59.999Z]` UTC, deduplicated and sorted ascending |
| otherwise, `dataStartTime` and/or `dataEndTime` present | a single span |
| neither present | `null` |

**`dataDates` wins over the extent when it yields anything.** A layer that
lists days is sparse; its extent describes the outer bounds of those days, not
continuous coverage between them.

Within the extent branch:

- A bound that is absent or unparseable is **open** — `-Infinity` for the
  start, `+Infinity` for the end. A layer naming only a start time is gated
  before it and unconstrained after.
- `dataEndTime === 'now'` resolves to `Date.now()` at call time, matching
  `resolveLayerExtent` in the Timeline plugin.
- Parsing is lenient (`new Date(...)`), because configs carry these bounds in
  looser formats than ISO 8601.
- `start > end` — a span the layer cannot hold data in — resolves to `null`
  and warns on the console. A self-contradictory config would otherwise make
  the layer un-drawable at every instant; ignoring the constraint is the
  recoverable failure, blanking the layer is not.

`dataDates` parsing is strict ISO 8601 with surrounding whitespace tolerated,
so a mistyped date costs that day rather than the whole layer — the same rule
`resolveListedDays` applies, so a layer's timeline bar and its requests agree
on which days exist.

```js
layerHasDataInWindow(layer) -> boolean
```

Resolves the layer's coverage and overlaps it against the window the layer
would request: `[layer.time.start, layer.time.end]`. Per `updateLayersTime`
that window is `[TimeControl.startTime, TimeControl.currentTime]` — the
current instant is the window's *end*, not its middle — so this is exactly the
range the request would ask the server for.

Overlap is inclusive at both edges: a window ending precisely at a coverage
span's start still overlaps it.

**Returns `true` whenever it cannot tell.** No coverage configured, a window
that will not parse, a missing `layer.time` — all resolve to "has data". The
gate may only ever suppress on positive evidence of absence; a bug in this
module must cost a wasted request, never a missing layer.

```js
describeDataCoverage(coverage) -> string | null
```

The human sentence naming what the layer does hold, for the popover:

- continuous: `Data available 2020-01-01 → 2020-03-01`
- one open bound: `Data available from 2020-01-01` / `Data available until 2020-03-01`
- sparse, many days: `Data available on 12 dates, 2020-01-02 → 2020-11-19`
- sparse, one day: `Data available on 2020-03-04` — the plural form reads
  wrongly at a count of one, and a single date needs no range after it
- `null` coverage: `null`

Dates render as `YYYY-MM-DD` in UTC. Coverage is declared at day granularity
for sparse layers and read from configs written by hand for continuous ones, so
a time of day here would be noise or, worse, a local-time shift away from the
day it names.

It lives beside the resolver so the wording cannot drift from the decision
that produced it.

### On duplicating the Timeline plugin's parsing

`resolveListedDays` and `resolveLayerExtent` in
`src/essence/Tools/Timeline/lib/utils/timeUtils.ts` already implement these
rules. This module does not import them: the core must not depend on a plugin,
and inverting the dependency would put a Timeline-shaped module in `Basics/`.

The duplication is real and is accepted with a guard: the test suite asserts
the two implementations agree on a shared table of configs, so a change to one
that is not mirrored fails. If the plugin boundary later grows a shared
utilities package, both should move into it.

## 2. The gate

Three call sites. All three are needed — each closes a path the others leave
open.

### `TimeControl.reloadLayer`

The time-change choke point. Immediately after the existing
`L_.layers.layer[layer.name] === null` guard, before any URL work:

```js
const mayTouch = evenIfControlled === true || layer.controlled !== true
const wouldRefresh = mayTouch && (L_.layers.on[layer.name] || evenIfOff)
const hasData = layerHasDataInWindow(layer)
L_.setLayerOutOfDataRange(layer.name, !hasData)
if (!hasData) {
    if (wouldRefresh) layer.time.current = TimeControl.currentTime
    if (mayTouch) Map_.engine?.setLayerVisibility(layer.name, false)
    return true
}
if (mayTouch)
    Map_.engine?.setLayerVisibility(layer.name, L_.layers.on[layer.name] === true)
// ...existing body
```

`mayTouch` repeats the condition the existing body already applies before every
write to a layer: a **controlled** layer is driven by an external caller, and a
reload that is not explicitly allowed to touch it must not move it on or off
the map either. The state record and the warning icon are still updated for a
controlled layer — the condition is reported, just not acted on — so the
Layers tool tells the truth about a layer this gate declines to move.

Placing it here, rather than deeper, is what makes it an optimization rather
than a cosmetic hide: the early return skips `performTimeUrlReplacements`, so a
layer with a `variables.urlReplacements` entry does not even make its
**external API call** while out of coverage, let alone request tiles.

`wouldRefresh` reproduces the condition the existing body uses to decide
whether to stamp `layer.time.current`, and the suppressed path stamps under
exactly the same condition. `catchUpLayerTime` compares that field to decide
whether a layer needs a reload when it is switched on, so a layer that was
suppressed while on must still read as current — otherwise every later toggle
re-runs a reload with nothing to do. The condition cannot be dropped in either
direction: stamping unconditionally would make a layer that is *off* look
current however far the time bar moved, which is the invariant the existing
comment there guards.

The `setLayerVisibility` on the has-data path restores a layer that was
suppressed and is now back in coverage, to the state its checkbox claims. It
is a no-op in the common case where nothing was suppressed.

### `L_.toggleLayerHelper`

The on-path currently reads:

```js
await catchUpLayerTime(s)
L_.Map_.engine.setLayerVisibility(s.name, true)
```

The literal `true` becomes `layerHasDataInWindow(s)`, so switching a layer on
while the window sits outside its coverage adds nothing to the map and
requests nothing. `L_.layers.on[s.name]` still records it as on, and it appears
the moment the window moves into coverage.

`setLayerOutOfDataRange` is called here too, so the warning icon appears on the
toggle rather than waiting for the next time change.

### `Map_.handOffToEngine`

The visible flag becomes `on && layerHasDataInWindow(layerObj)`, so a layer
*created* outside its coverage never fetches even once.

This gate is reachable: `Map_.init()` runs after `TimeControl.init()`, which
seeds every time-enabled layer's `time.start` / `time.end` through
`initLayerTimes` / `initLayerDataTimes`. The window is therefore already known
when layers are built. Were that ordering ever to change,
`layerHasDataInWindow` would see an unparseable window and answer `true`,
costing one round of requests that the first `reloadTimeLayers` then corrects
— degraded, not broken.

## 3. State record

```
L_.layers.outOfDataRange   // uuid -> true
L_.setLayerOutOfDataRange(name, isOut)
```

Written **only** through the setter, which mirrors `setLayerLoadStatus`:
compare against the previous value, return early when unchanged, then emit.
Suppressing no-op emissions matters here — `reloadTimeLayers` walks every
time-enabled layer on every time step, and a scrubbed timeline would otherwise
emit thousands of identical events.

Cleared on mission change alongside `L_.layers.loadStatus`, in both places that
registry is reset (the whole-registry reset and the per-layer delete).

Exposed on the bus:

- `layers:dataRangeChanged` — `{ layerName, outOfDataRange }`
- `mmgisAPI.provide('layers:isOutOfDataRange', layerUUID)` — that layer's
  boolean with an argument, the whole name-keyed map without, matching
  `layers:getLoadStatus`.

The provider is what lets the Timeline plugin, or any marketplace plugin,
reflect the state without reaching into `L_` — the boundary the vision calls
for.

## 4. UI signal

In `src/essence/Tools/Layers/LayersTool.js`.

**No dimming.** The row, its checkbox, its label and its other controls are
untouched.

**The icon.** A `.noDataWarning` element (`mdi-calendar-remove`, `mdi-18px`) is
rendered in the row's icon strip next to the existing `.refreshWarning`,
hidden. It joins the shared sizing rule in `LayersTool.css` that already lists
`.refreshWarning`, `.gears`, `.locate` and the rest, and takes its own colour
rule from `var(--color-h)` — the same warning colour `.refreshWarning` uses.

It is rendered for time-enabled layers only; a layer that can never be out of
coverage does not carry a hidden element for a state it cannot reach.

**The popover.** A tippy instance bound to the icon — `placement: 'right'`,
matching the panel's other tooltips, so it opens over the map rather than back
across the row; `theme: 'red'`; `allowHTML: true`. Content:

> **No data at this time**
> `2020-05-04T12:00:00Z`
> Data available 2020-01-01 → 2020-03-01

The first line states the condition, the second the instant asked for, the
third is `describeDataCoverage`. Content is set when the list is built and
re-set on every `layers:dataRangeChanged`, so the instant named is the instant
currently being asked for and not the one the row was drawn at.

**Lifecycle.** Every other `tippy(...)` call in this file targets a singleton
element and discards the handle. These are per-row and the list is rebuilt
often, so the handles are kept in a module-level array and destroyed both
before a rebuild and in `separateFromMMGIS`. Without that, each rebuild stacks
another instance on the same icon and the popovers multiply.

**Initial sync.** On build, rows are reconciled against
`L_.layers.outOfDataRange`, the way the existing loop reconciles
`L_.layers.refreshFailed`. A layer suppressed before the Layers tool was opened
shows its icon as soon as the panel is drawn.

The tool subscribes through `window.mmgisAPI.on('layers:dataRangeChanged', …)`
rather than a `document` event. The existing `layerRefreshStatusChanged`
listener predates the bus; new listeners should not add to that pattern.

## 5. Configuration

**Rewrite the field descriptions** for `time.dataStartTime`,
`time.dataEndTime` and `time.dataDates`. Each currently ends "This is for
display purposes only and does not constrain queries", which this change makes
false. Replace with wording that states the layer will not be requested outside
the declared coverage, and that leaving a field empty leaves that direction
unconstrained.

**Add the Data Time Extent subsection** to `layer-vectortile-config.json`,
`layer-query-config.json` and `layer-velocity-config.json`. Only
`layer-tile-config.json` and `layer-vector-config.json` expose these fields
today, so without this the "all time-enabled layers" decision is unreachable
for three of the types it names. Each already has a Time section for it to
join.

## Testing

**`layerDataCoverage` unit tests** (`__tests__/layerDataCoverage.spec.js`),
mirroring the structure of the Timeline plugin's `layerTimeRanges.spec.ts`:

- `dataDates` takes precedence over a configured extent
- `dataDates` deduplicates same-day entries, sorts ascending, tolerates
  surrounding whitespace, drops unreadable entries, and accepts a bare string
- a `dataDates` list with nothing readable falls back to the extent
- an absent or unparseable bound is open in that direction
- `dataEndTime: 'now'`
- `time.enabled !== true` → `null`
- inverted extent → `null` and warns
- overlap is inclusive at both edges; a window entirely between two sparse days
  does not overlap
- `layerHasDataInWindow` returns `true` for an unparseable window, a missing
  `layer.time`, and no configured coverage

**Agreement test**: a shared table of configs run through both
`resolveDataCoverage` and the Timeline plugin's `resolveLayerTimeRanges`,
asserting the same spans. This is the guard on the accepted duplication.

**Gate tests**: `reloadLayer` on an out-of-coverage layer calls
`setLayerVisibility(name, false)`, does **not** call the engine's refresher, and
does not call `performTimeUrlReplacements`; on a layer returning to coverage it
restores visibility from `L_.layers.on` and proceeds to refresh; on a
`controlled` layer without `evenIfControlled` it records the state and emits
the event but does not call `setLayerVisibility` at all; and it stamps
`layer.time.current` on the suppressed path only when the layer is on or
`evenIfOff` was passed.

**Manual check**: a mission with one sparse layer and one continuous layer,
stepping the timeline across a gap with the network panel open — no requests
for the suppressed layer, the icon appears, the popover names the right
instant, and the layer returns intact on the way back.

## Risks

**Behavior change for existing missions.** Any layer whose config declares
coverage it does not actually respect will now disappear outside those bounds
where it previously drew. This is the intended contract change and the reason
for the popover: the layer explains itself rather than silently vanishing. It
is called out in the field descriptions and belongs in the release notes.

**Wide windows blunt the optimization.** The gate tests window overlap, not the
current instant. A timeline window spanning a year overlaps a sparse layer's
twelve days, so no requests are suppressed. This is correct — the request
genuinely asks for a range that contains data — but means the saving is
realized when stepping through narrow windows, which is the scrubbing case that
motivates it.

**Globe divergence.** Until the globe is gated, a mission using both views
suppresses requests on the map and not on the globe. Consistent behavior, not
correctness: the globe simply keeps today's behavior.

## Files

| File | Change |
| --- | --- |
| `src/essence/Basics/TimeControl_/layerDataCoverage.js` | new — the pure coverage module |
| `src/essence/Basics/TimeControl_/__tests__/layerDataCoverage.spec.js` | new — unit and agreement tests |
| `src/essence/Basics/TimeControl_/TimeControl.js` | gate in `reloadLayer` |
| `src/essence/Basics/Layers_/Layers_.js` | `outOfDataRange` registry, setter, bus event, API provider, mission-change cleanup, `toggleLayerHelper` gate |
| `src/essence/Basics/Map_/Map_.js` | `handOffToEngine` visibility gate |
| `src/essence/Tools/Layers/LayersTool.js` | warning icon, tippy popover, bus subscription, initial sync, instance cleanup |
| `src/essence/Tools/Layers/LayersTool.css` | `.noDataWarning` styling |
| `configure/src/metaconfigs/layer-tile-config.json` | rewrite field descriptions |
| `configure/src/metaconfigs/layer-vector-config.json` | rewrite field descriptions |
| `configure/src/metaconfigs/layer-vectortile-config.json` | add Data Time Extent subsection |
| `configure/src/metaconfigs/layer-query-config.json` | add Data Time Extent subsection |
| `configure/src/metaconfigs/layer-velocity-config.json` | add Data Time Extent subsection |
