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
(the label is what the Variable dropdown, footer, and CSV key on).

Payload capabilities: multiple series per chart, `y: null` gaps (not
interpolated), per-series `line`/`area`/`bar` style and color, and per-series
`unit`, shown in the card footer chip. One variable renders at a time: a
payload with several series gets a variable picker above the chart (see
`layout` below), and the chart, footer chip and CSV follow the pick. Mixed units therefore never need
a dual y-axis. The payload's `subtitle` renders under the title as the
section heading (FetchTimeseries sends the layer's display name); `meta` is
carried but not rendered.

Time axes render on a linear epoch-ms scale with UTC tick/tooltip
formatting; timezone-less ISO datetimes are read as UTC.

## Configuration

`variables.sources` — array of fetcher plugin ids to listen to
(default `["fetch-timeseries"]`). Wiring a new fetcher into the chart is a
config entry, not a code change:

```json
{ "sources": ["fetch-timeseries", "fetch-raster-timeseries"] }
```

`variables.layout` — how the variable picker renders when a payload carries
several variables. `"dropdown"` (default) puts a select above the chart, for
a narrow side panel. `"list"` puts a wrapping row of buttons above the chart,
for a wide bottom panel where every variable fits on one line. One variable
shows at a time either way, and the chart, footer chip and CSV follow the
pick.

The card itself is one design: a clean symbol-less line, sparse unnamed
y-axis, a preview zoom strip (the series ghosted inside the slider, dragging
it is the zoom and the reset), and a footer chip naming the variable and unit
with a hover hint and a Download CSV link.

## Smoke test (devtools console)

```js
window.mmgisAPI.emit('plugin:fetch-timeseries:seriesReady', {
    chartId: 'demo', title: 'Station 42',
    series: [{ id: 'no2', label: 'NO₂', points: [
        { x: '2026-01-01T00:00:00Z', y: 1.2 },
        { x: '2026-02-01T00:00:00Z', y: 2.4 },
        { x: '2026-03-01T00:00:00Z', y: 1.8 },
    ] }],
})
```

See [FetchTimeseries](../FetchTimeseries/README.md) for a working
end-to-end demo against live AQS station data.
