# FetchTimeseries plugin

No-UI background plugin: when the user clicks a vector feature whose layer
opts in, it fetches that feature's time series and publishes it as
chart-series events for the [SeriesChart plugin](../SeriesChart/README.md).
Bus-only — no core imports, no rendering.

## Behavior

- Listens to `feature:click` (`{ feature, layerName, latlng, pixel }`).
- Layer has no `variables.timeseries` block → the click does **nothing**
  chart-wise (no fetch, no empty chart).
- Eligible click → emits `seriesLoading`, fetches, then `seriesReady` with a
  `ChartSeriesPayload` (see
  [`_shared/types/chartSeries.ts`](../_shared/types/chartSeries.ts)) or
  `seriesError` with a human-readable message (HTTP failure, bad URL
  template, unusable response shape).
- A new click aborts any in-flight fetch and replaces the chart (single
  `chartId: 'vector-timeseries'`). Deselecting emits `seriesCleared`.

Events (all under `plugin:fetch-timeseries:`): `seriesLoading`,
`seriesReady`, `seriesError`, `seriesCleared`.

## Layer configuration (`layer.variables.timeseries`)

| Field | Required | Meaning |
| --- | --- | --- |
| `url` | yes | Fetch URL template. Placeholders: `{id}`, `{properties.<key>}`, `{lon}`/`{lat}` (Point features). Values are URL-encoded; a missing value surfaces as a visible error. |
| `titleProp` | no | Feature property used as the chart title (default: `name` → `title` → feature id → layer name). |
| `label` | no | Series label for ungrouped responses (default: layer display name). |
| `yLabel` | no | y-axis label; when omitted, series units (see `unitKey`) are used. |
| `seriesPath` | no | Dot-path to the point array (default: the response itself if an array, else the first array under `data`/`values`/`timeseries`/`items`/`results`/`features`). |
| `xKey` / `yKey` | no | Dot-paths to a point's time/value (default: `datetime`/`date`/`time`/… and `value`/`y`/`mean`/…, probed at the top level and under `properties.` — GeoJSON observation features work with zero config). |
| `groupBy` | no | Dot-path whose distinct values split the response into one series each (e.g. one line per measured parameter). |
| `unitKey` | no | Dot-path to a point's unit, carried onto its series; two distinct units render on dual y-axes. |

Parallel-array responses (`{ times: [...], vals: [...] }`) are supported by
pointing `xKey`/`yKey` at the two arrays.

## Working demo: EPA AQS stations (dev.openveda.cloud)

Vector layer (point stations):

```
https://dev.openveda.cloud/api/features/collections/public.aqs_gases_metadata/items?limit=1000
```

Layer `variables`:

```json
{
    "timeseries": {
        "url": "https://dev.openveda.cloud/api/features/collections/public.aqs_sites_gases/items?station_code={properties.station_code}&limit=1000",
        "titleProp": "local_site_name",
        "groupBy": "properties.parameter",
        "unitKey": "properties.units_of_measure"
    }
}
```

Notes:

- The observation features carry `datetime`/`value` under `properties`, so
  `xKey`/`yKey` need no configuration.
- Keep the `limit=1000` on the timeseries URL: the API defaults to 10 items
  per page and this plugin does not follow `rel: next` pagination links.
- `groupBy` yields one series per parameter (e.g. PM2.5 + Ozone); their two
  units land on left/right y-axes in SeriesChart.

Place SeriesChart in a panel (its default `sources` already includes
`fetch-timeseries`), add FetchTimeseries to the mission's tools, click a
station.
