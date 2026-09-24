# FetchTimeseries plugin

No-UI background plugin: when asked for a vector feature whose layer opts
in, it fetches that feature's time series and publishes it as chart-series
events for the [SeriesChart plugin](../SeriesChart/README.md). Bus-only — no
core imports, no rendering.

## Behavior

- Listens to `plugin:fetch-timeseries:fetch` (`{ feature, layerId, latlng }`).
  Anything may emit it; the shipped emitter is a
  [Feature Popup](../FeaturePopup/) card action, see below.
- Layer has no `variables.timeseries` block → the request does **nothing**
  chart-wise (no fetch, no empty chart).
- Eligible request → emits `seriesLoading`, fetches, then `seriesReady` with
  the `ChartSeriesPayload` itself as the (flat, unenveloped) event payload
  (see [`_shared/types/chartSeries.ts`](../_shared/types/chartSeries.ts)),
  or `seriesError` with a human-readable message (HTTP failure, timeout,
  bad URL template, unusable response shape).
- A new request aborts any in-flight fetch and replaces the chart (single
  `chartId: 'vector-timeseries'`); charts persist until replaced. Fetches
  time out after 30 seconds so a stalled connection cannot strand the
  spinner.
- Tool teardown (`destroy`) aborts any in-flight fetch and emits
  `seriesCleared` so no card is left behind.

Events (all under `plugin:fetch-timeseries:`): `seriesLoading`,
`seriesReady`, `seriesError`, `seriesCleared`.

## Triggering it from the Feature Popup

The Feature Popup shows a card when a feature is clicked and emits a
configured event when one of its buttons is pressed. Give the layer a
`variables.featurePopup` block with an action whose `event` is this plugin's
fetch event; the card gets a button and pressing it charts the feature:

```json
{
    "featurePopup": {
        "enabled": true,
        "title": "{local_site_name}",
        "actions": [
            { "label": "Timeseries", "event": "plugin:fetch-timeseries:fetch" }
        ]
    },
    "timeseries": { "url": "..." }
}
```

The popup runs on the deck.gl engine. Under Leaflet, or from another plugin,
emit `plugin:fetch-timeseries:fetch` with `{ feature, layerId, latlng }`
yourself; this plugin does not care who sent it.

## Layer configuration (`layer.variables.timeseries`)

| Field | Required | Meaning |
| --- | --- | --- |
| `enabled` | no | Set `false` to turn the block off without deleting it (default `true`). |
| `url` | yes | Fetch URL template. Placeholders: `{properties.<key>}` (dot-paths work), `{lon}`/`{lat}` (the feature's Point coordinates, falling back to the clicked location — so they work on vector-tile layers whose features carry no geometry), and `{id}` (only when the source data itself provides feature ids — MMGIS does not assign them, so prefer `{properties.<key>}`). Values are URL-encoded; a missing value surfaces as a visible error. Braces are placeholder syntax — a literal `{`/`}` (e.g. CQL2 filters) is not supported. |
| `titleProp` | no | Feature property used as the chart title (default: `name` → `title` → feature id → layer name). |
| `label` | no | Series label for ungrouped responses (default: layer display name). |
| `seriesPath` | no | Dot-path to the point array when the response is an object (default `features`, the GeoJSON FeatureCollection shape). Ignored when the response is itself an array. |
| `xKey` / `yKey` | no | Dot-paths to a point's time and value (defaults `datetime` and `value`), resolved at the point's top level and under `properties.`, so GeoJSON observation features need nothing set. Time values are ISO datetime strings or epoch milliseconds. |
| `groupBy` | no | Dot-path whose distinct values split the response into one series each (e.g. one line per measured parameter). |
| `unitKey` | no | Dot-path to a point's unit, carried onto its series; SeriesChart shows it in the card footer next to the variable name. |

## Working demo: EPA AQS stations (dev.openveda.cloud)

Vector layer (point stations):

```
https://dev.openveda.cloud/api/features/collections/public.aqs_gases_metadata/items?limit=1000
```

Layer `variables`:

```json
{
    "featurePopup": {
        "enabled": true,
        "title": "{local_site_name}",
        "actions": [
            { "label": "Timeseries", "event": "plugin:fetch-timeseries:fetch" }
        ]
    },
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
  When a response reports more matches than it returned
  (`numberMatched`/`numberReturned`), the chart title carries a
  "first N of M points" notice instead of presenting a page as the record.
- `groupBy` yields one series per parameter (e.g. PM2.5 + Ozone); the
  SeriesChart legend picks which one is visible and the card footer shows
  its unit.

Place SeriesChart in a panel (its default `sources` already includes
`fetch-timeseries`), add FetchTimeseries and FeaturePopup to the mission's
tools, click a station, press Timeseries on its card.
