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
the timeline's current time sits outside that coverage, on either map engine,
whether it was switched on before, during, or after the time moved out. When
the time moves back into coverage the layer returns, current.

A layer that declares no coverage keeps today's behavior exactly.

## Scope

**In scope**: all time-enabled layer types — `tile`, `vectortile`, `vector`,
`query`, `velocity`, and the deck.gl equivalents — on both the Leaflet and
DeckGL engines.

Delivered in two phases:

**Phase 1 — the gate.** The coverage module, the three core gate points, the
state record and its bus surface, the Layers tool's warning icon and popover,
and the config changes. Ships the optimization.

**Phase 2 — the Timeline reads from core.** The Timeline plugin drops
`resolveListedDays` and `resolveLayerExtent` from
`lib/utils/timeUtils.ts` and takes its spans from `layers:getDataCoverage`.
`resolveLayerTimeRanges` becomes a thin read of the served spans;
`resolveLayerNavigation` derives its sparse stops from each span's end and its
periodic bounds from a continuous span, reading an open bound as the
`hasOwnStart` / `hasOwnEnd` it computes today (an unconfigured bound arrives as
`-Infinity` / `Infinity`, which is exactly that information).

Phase 2 is what makes the core the single authority rather than one of two
opinions, so it is scope, not a nice-to-have. Phase 1 must not ship as the
permanent arrangement.

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
   no `L_`, no prose.
2. **The gate** — three core call sites that ask (1) a question and act on it.
   All gating lives here; nothing outside the core decides whether a layer is
   requested.
3. **The state record** — one registry on `L_`, one bus event and one bus
   request handler. This is the only surface anything outside the core sees.
4. **The consumers** — the Layers tool renders the warning, the Timeline draws
   its bars. Neither computes coverage; both read it off the bus.

```
layerDataCoverage.js  →  the gate  →  L_ registry  →  bus  →  plugins
      (pure)              (core)        (core)                (read-only)
```

The dependency runs one way and stops at the bus. Nothing outside `Basics/`
imports the coverage module, reads `L_` for this state, or re-derives coverage
from raw layer config. Nothing in the core knows which plugins, if any, are
listening.

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

Resolves the layer's coverage and tests it at the current time: the end of the
window the layer would request, `[layer.time.start, layer.time.end]`. Per
`updateLayersTime` that window is `[TimeControl.startTime,
TimeControl.currentTime]` — the current instant is the window's *end*, not its
middle. Readable `dataDates` decide; failing those, the extent does.

The window's start plays no part. A wide window overlaps nearly any coverage —
a mission opening on 2012-01-19 → 2026-08-12 overlaps almost every layer's —
while most layers request only the current instant (`{time}`), so testing
overlap would leave them requested at instants they have no data for. The rule
applies to every time-enabled layer whatever its URL requests.

Containment is inclusive at both edges: a listed entry covers the whole year,
month, day or hour it names, from its first millisecond to its last.

**Returns `true` whenever it cannot tell.** No coverage configured, a window
that will not parse, a missing `layer.time` — all resolve to "has data". The
gate may only ever suppress on positive evidence of absence; a bug in this
module must cost a wasted request, never a missing layer.

```js
resolveCoverageKind(coverage) -> 'continuous' | 'sparse' | null
```

Whether the spans came from a listed set of days or from a single extent.
A subscriber needs this to word itself correctly — "available on 12 dates"
against "available 2020-01-01 to 2020-03-01" — and it is not recoverable from
the spans alone.

**The module produces no prose.** No sentence, no date formatting, no
`describeDataCoverage`. Wording and formatting are presentation: they belong to
whatever renders them, and a sentence baked into the core is a sentence no
plugin can restyle, shorten or translate. The core answers *what is true*; a
plugin decides how to say it.

### The core is the authority on coverage

`resolveListedDays` and `resolveLayerExtent` in
`src/essence/Tools/Timeline/lib/utils/timeUtils.ts` implement these same rules
today, because the timeline was the only consumer. Once the core gates requests
on coverage there are two derivations of one fact, free to disagree — a layer's
timeline bar could show a day whose tiles the gate suppresses.

The vision settles which wins: **the core derives coverage and serves it;
plugins read it.** So this is not a duplication to be accepted and policed with
an agreement test. The plugin's copy is deleted (Phase 2) and the Timeline
reads spans off the bus like any other consumer.

The precedent is `layers:getCogCapabilities`: the core derives a fact about
layers — whether a layer has a colormap, whether it can be changed — and serves
it as structured data, rather than letting each plugin re-derive it from raw
config. Coverage is the same shape of problem and takes the same shape of
answer.

## 2. The gate

Three call sites. All three are needed — each closes a path the others leave
open.

### `TimeControl.reloadLayer`

The time-change choke point. Immediately after the existing
`L_.layers.layer[layer.name] === null` guard, before any URL work:

```js
const mayTouch = evenIfControlled === true || layer.controlled !== true
const wouldRefresh = mayTouch && (L_.layers.on[layer.name] || evenIfOff)
const coverage = resolveDataCoverage(layer.time)
const hasData = layerHasDataInWindow(layer)
L_.setLayerDataCoverage(layer.name, {
    outOfDataRange: !hasData,
    kind: resolveCoverageKind(coverage),
    spans: coverage,
    requestedWindow: parseWindow(layer.time),
})
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
the map either. The state record is still published for a controlled layer — the condition is
reported, just not acted on — so a consumer tells the truth about a layer this
gate declines to move.

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
while the current time sits outside its coverage adds nothing to the map and
requests nothing. `L_.layers.on[s.name]` still records it as on, and it appears
the moment the time moves into coverage.

`setLayerDataCoverage` is called here too, so a consumer learns of the state on
the toggle rather than waiting for the next time change.

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

## 3. State record and the plugin boundary

The core holds the state; everything outside the core reads it over the bus.
Nothing outside `Basics/` imports `layerDataCoverage.js`, and nothing outside
`Basics/` reads `L_` for this feature.

### Core state

```
L_.layers.dataCoverage   // uuid -> LayerDataCoverage
L_.setLayerDataCoverage(name, coverage)
```

Written **only** through the setter, which mirrors `setLayerLoadStatus`:
compare against the previous value, return early when unchanged, then emit.
Suppressing no-op emissions matters here — `reloadTimeLayers` walks every
time-enabled layer on every time step, and a scrubbed timeline would otherwise
emit thousands of identical events.

Cleared on mission change alongside `L_.layers.loadStatus`, in both places that
registry is reset (the whole-registry reset and the per-layer delete).

### The record served

```ts
type LayerDataCoverage = {
    // Whether the gate is currently suppressing this layer's requests.
    outOfDataRange: boolean
    // 'sparse' from dataDates, 'continuous' from an extent, null when the
    // layer declares no coverage and is never gated.
    kind: 'continuous' | 'sparse' | null
    // Epoch ms. An open bound is -Infinity / Infinity. Null when kind is null.
    spans: { start: number; end: number }[] | null
    // The window the layer would request, epoch ms — what the gate compared
    // the spans against.
    requestedWindow: { start: number; end: number } | null
}
```

The payload carries **every fact a subscriber needs to render the state**: what
was asked for, what the layer holds, and the verdict. That completeness is the
whole point — a thin `{ layerName, outOfDataRange }` payload would send every
consumer back into `L_` or into the raw config to find the rest, which is
exactly the coupling the vision forbids.

### The bus surface

| Name | Kind | Payload |
| --- | --- | --- |
| `layers:dataCoverageChanged` | event | `{ layerName, ...LayerDataCoverage }` |
| `layers:getDataCoverage` | request | with a `layerUUID`, that layer's record; without, the whole UUID-keyed map |

Both registered in `Layers_` beside `layers:getCogCapabilities`, whose shape
they follow deliberately.

A typed wrapper — `mmgisGetLayerDataCoverage(layerUUID?)` and the
`LayerDataCoverage` type — goes into
`src/essence/Tools/_shared/adapters/mmgisAPI.ts`, the shared client whose own
docs state that plugins reach core "only through this shared client — and only
via the request/provide bus (string-named messages survive a sandbox boundary;
direct method calls don't)". Marketplace plugins get the same surface the
in-tree ones do.

### What the core does not do

The core never names the Layers tool, the Timeline, or any other consumer. The
gate runs and the state is published whether or not anything is listening; a
mission with no layer list still suppresses the requests. Remove every plugin
from the build and the optimization still works — that is the test of whether
this is core-side gating or a tool feature wearing core clothes.

## 4. UI signal

In `src/essence/Tools/Layers/LayersTool.js`. This is a **consumer**: it renders
the state and computes none of it.

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
> Data available 2020-01-01 to 2020-03-01

The first line states the condition, the second the instant asked for
(`requestedWindow.end`), the third the coverage. **The tool words and formats
these itself** from the record's `kind` and `spans` — the core ships facts, not
sentences:

- `continuous`: `Data available <start> to <end>`, and with an open bound,
  `Data available from <start>` / `Data available until <end>`
- `sparse`, several days: `Data available on 12 dates, <first> to <last>`
- `sparse`, one day: `Data available on 2020-03-04` — the plural reads wrongly
  at a count of one, and a single date needs no range after it

Dates render `YYYY-MM-DD` in UTC. Sparse coverage is declared at day
granularity and continuous bounds come from hand-written configs, so a time of
day would be noise — or, read locally, a shift off the day it names.

**Reading the state.** Both on build and on every update, through the bus:

```js
window.mmgisAPI.request('layers:getDataCoverage')      // initial sync
window.mmgisAPI.on('layers:dataCoverageChanged', …)     // live updates
```

The tool already uses `window.mmgisAPI` for its own `provide` and `emit` calls,
so this is idiomatic there. It reads `L_` heavily elsewhere — a legacy coupling
this spec does not try to unwind — but **new** core-reaching goes through the
bus. A migration that never stops adding to the pile never finishes.

The initial sync covers a layer suppressed before the panel was ever opened;
without it the icon would appear only on the next time step.

**Lifecycle.** Every other `tippy(...)` call in this file targets a singleton
element and discards the handle. These are per-row and the list is rebuilt
often, so the handles are kept in a module-level array and destroyed both
before a rebuild and in `separateFromMMGIS`, alongside the bus unsubscribe
returned by `on`. Without that, each rebuild stacks another instance on the
same icon and the popovers multiply.
## 5. Configuration

**Rewrite the field descriptions** for `time.dataStartTime`,
`time.dataEndTime` and `time.dataDates`. Each currently ends "This is for
display purposes only and does not constrain queries", which this change makes
false. Replace with wording that states the layer will not be requested while
the timeline's current time is outside the declared coverage, that readable
`dataDates` decide in place of the extent, and that leaving a field empty
leaves that direction unconstrained.

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
- an entry holds the current time inclusively at both edges; a time between
  two sparse entries, or just past one, has no data
- a wide window that overlaps coverage but ends outside it has no data
- `layerHasDataInWindow` returns `true` for an unparseable window, a missing
  `layer.time`, and no configured coverage

**Boundary tests** — the check that this is core-side gating and not a tool
feature:

- with every consumer removed, an out-of-coverage layer is still suppressed;
  the gate depends on no plugin being mounted
- `layers:getDataCoverage` answers with a layer's whole record — verdict, kind,
  spans, requested window — so a consumer needs no second lookup
- a lint-level assertion that nothing under `src/essence/Tools/` imports
  `layerDataCoverage.js`, and that the Layers tool's coverage handling touches
  no `L_.layers.dataCoverage` directly

**Phase 2 regression test**: the Timeline's bars and navigation stops are
unchanged across the migration, driven by the same config table that covers the
resolver — the served spans must reproduce what the plugin drew when it parsed
the config itself.

**Gate tests**: `reloadLayer` on an out-of-coverage layer calls
`setLayerVisibility(name, false)`, does **not** call the engine's refresher, and
does not call `performTimeUrlReplacements`; on a layer returning to coverage it
restores visibility from `L_.layers.on` and proceeds to refresh; on a
`controlled` layer without `evenIfControlled` it publishes the state but does
not call `setLayerVisibility` at all; and it stamps
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

**Range-requesting layers.** A layer whose URL asks for a
`{starttime}`–`{endtime}` range is suppressed whenever the current time is not
covered, even though the range request might have returned a mosaic of the
window. The declared coverage is the source of truth.

**Globe divergence.** Until the globe is gated, a mission using both views
suppresses requests on the map and not on the globe. Consistent behavior, not
correctness: the globe simply keeps today's behavior.

## Files

### Phase 1 — core

| File | Change |
| --- | --- |
| `src/essence/Basics/TimeControl_/layerDataCoverage.js` | new — the pure coverage module: spans, kind, current-time verdict. No prose. |
| `src/essence/Basics/TimeControl_/__tests__/layerDataCoverage.spec.js` | new — resolver and verdict unit tests |
| `src/essence/Basics/TimeControl_/TimeControl.js` | gate in `reloadLayer` |
| `src/essence/Basics/Layers_/Layers_.js` | `dataCoverage` registry, `setLayerDataCoverage`, `layers:dataCoverageChanged` event, `layers:getDataCoverage` handler, mission-change cleanup, `toggleLayerHelper` gate |
| `src/essence/Basics/Map_/Map_.js` | `handOffToEngine` visibility gate |

### Phase 1 — consumers and config

| File | Change |
| --- | --- |
| `src/essence/Tools/_shared/adapters/mmgisAPI.ts` | `LayerDataCoverage` type and `mmgisGetLayerDataCoverage` wrapper |
| `src/essence/Tools/Layers/LayersTool.js` | warning icon, tippy popover, its own wording of the record, bus subscription and initial sync, instance cleanup |
| `src/essence/Tools/Layers/LayersTool.css` | `.noDataWarning` styling |
| `configure/src/metaconfigs/layer-tile-config.json` | rewrite field descriptions |
| `configure/src/metaconfigs/layer-vector-config.json` | rewrite field descriptions |
| `configure/src/metaconfigs/layer-vectortile-config.json` | add Data Time Extent subsection |
| `configure/src/metaconfigs/layer-query-config.json` | add Data Time Extent subsection |
| `configure/src/metaconfigs/layer-velocity-config.json` | add Data Time Extent subsection |

### Phase 2 — Timeline reads from core

| File | Change |
| --- | --- |
| `src/essence/Tools/Timeline/lib/utils/timeUtils.ts` | delete `resolveListedDays` and `resolveLayerExtent`; `resolveLayerTimeRanges` reads served spans |
| `src/essence/Tools/Timeline/lib/utils/layerNavigation.ts` | derive stops and bounds from served spans |
| `src/essence/Tools/Timeline/TimelineAdapter.tsx` | request coverage, subscribe to `layers:dataCoverageChanged` |
| `src/essence/Tools/Timeline/__tests__/*` | retarget `layerTimeRanges` / `layerNavigation` specs at the served spans |
