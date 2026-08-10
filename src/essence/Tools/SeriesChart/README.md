# SeriesChart plugin

Generic, presentation-only chart panel. It renders whatever chart-series
payloads arrive on the bus and knows nothing about data sources — any plugin
that emits the shared contract can drive it. Bus-only, no core imports.

## The contract

Defined in [`_shared/types/chartSeries.ts`](../_shared/types/chartSeries.ts).
A fetcher plugin with id `<id>` emits (names via `seriesEvents('<id>')`):

- `plugin:<id>:seriesLoading` `{ chartId, title? }` → card shows a spinner
- `plugin:<id>:seriesReady` `{ payload: ChartSeriesPayload }` → card renders the chart
- `plugin:<id>:seriesError` `{ chartId, message }` → card shows the message
- `plugin:<id>:seriesCleared` `{ chartId }` → card is removed

One card per `chartId`; a new payload with the same `chartId` replaces the
previous chart. Malformed payloads are dropped with a console warning
(`isChartSeriesPayload` guard) — they never crash the panel.

Payload capabilities: multiple series per chart, `time`/`linear`/`category`
x-axes, `y: null` gaps (not interpolated), per-series `line`/`area`/`bar`
style and color, and per-series `unit` — exactly two distinct units split
onto left/right y-axes.

Time axes render on a linear epoch-ms scale with UTC tick/tooltip formatting
(no Chart.js date-adapter dependency); timezone-less ISO datetimes are read
as UTC.

## Configuration

`variables.sources` — array of fetcher plugin ids to listen to
(default `["fetch-timeseries"]`). Wiring a new fetcher into the chart is a
config entry, not a code change:

```json
{ "sources": ["fetch-timeseries", "fetch-raster-timeseries"] }
```

## Smoke test (devtools console)

```js
window.mmgisAPI.emit('plugin:fetch-timeseries:seriesReady', { payload: {
    chartId: 'demo', title: 'Station 42', xType: 'time',
    series: [{ id: 'no2', label: 'NO₂', points: [
        { x: '2026-01-01T00:00:00Z', y: 1.2 },
        { x: '2026-02-01T00:00:00Z', y: 2.4 },
        { x: '2026-03-01T00:00:00Z', y: 1.8 },
    ] }],
} })
```

See [FetchTimeseries](../FetchTimeseries/README.md) for a working
end-to-end demo against live AQS station data.
