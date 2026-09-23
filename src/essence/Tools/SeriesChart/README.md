# SeriesChart plugin

Generic, presentation-only chart panel. It renders whatever chart-series
payloads arrive on the bus and knows nothing about data sources — any plugin
that emits the shared contract can drive it. Bus-only, no core imports.

## The contract

Defined in [`_shared/types/chartSeries.ts`](../_shared/types/chartSeries.ts).
A fetcher plugin with id `<id>` emits (names via `seriesEvents('<id>')`):

- `plugin:<id>:seriesLoading` `{ chartId, title? }` → card shows a spinner
- `plugin:<id>:seriesReady` `ChartSeriesPayload` → card renders the chart
- `plugin:<id>:seriesError` `{ chartId, message }` → card shows the message
- `plugin:<id>:seriesCleared` `{ chartId }` → card is removed

All four messages are flat, with `chartId` at the top level — `seriesReady`'s
payload is the `ChartSeriesPayload` itself, not wrapped in an envelope.

One card per `chartId`; a new payload with the same `chartId` replaces the
previous chart. Malformed payloads are dropped with a console warning
(`isChartSeriesPayload` guard) — they never crash the panel. Series `id`s
and `label`s must be unique within a payload; duplicates count as malformed
(the label is what the legend picker, footer, and CSV key on).

Payload capabilities: multiple series per chart, `time`/`linear`/`category`
x-axes, `y: null` gaps (not interpolated), per-series `line`/`area`/`bar`
style and color, and per-series `unit`, shown in the card footer chip. One
variable renders at a time — mixed-unit payloads work by picking (single
layout) or stacking (stacked layout), never a dual y-axis. The payload's
`subtitle`, `yLabel`, and `meta` fields are reserved: accepted, not yet
rendered.

Time axes render on a linear epoch-ms scale with UTC tick/tooltip
formatting; timezone-less ISO datetimes are read as UTC.

## Configuration

`variables.sources` — array of fetcher plugin ids to listen to
(default `["fetch-timeseries"]`). Wiring a new fetcher into the chart is a
config entry, not a code change:

```json
{ "sources": ["fetch-timeseries", "fetch-raster-timeseries"] }
```

`variables.layout` — `"single"` (default) or `"stacked"`. Both share one
design: a clean symbol-less line, sparse unnamed y-axis, a preview zoom strip
(the series ghosted inside the slider), and a footer chip naming the variable
and unit with a hover hint and a Download CSV link. Single renders all of a
card's variables in one chart — the single-select legend picks the visible
one, and the strip, footer, and CSV follow the pick. Stacked renders one such
card per variable (each zooming independently, mixed units without a dual
axis), capped at ~1.5 cards tall with the rest scrolling inside the card.

## Smoke test (devtools console)

```js
window.mmgisAPI.emit('plugin:fetch-timeseries:seriesReady', {
    chartId: 'demo', title: 'Station 42', xType: 'time',
    series: [{ id: 'no2', label: 'NO₂', points: [
        { x: '2026-01-01T00:00:00Z', y: 1.2 },
        { x: '2026-02-01T00:00:00Z', y: 2.4 },
        { x: '2026-03-01T00:00:00Z', y: 1.8 },
    ] }],
})
```

See [FetchTimeseries](../FetchTimeseries/README.md) for a working
end-to-end demo against live AQS station data.
