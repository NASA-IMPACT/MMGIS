# FetchTimeseries plugin

A small card holding a Start and End instant, over the fetch that charts a
vector feature's time series. When asked for a feature whose layer opts in,
the card appears, the feature's series is fetched over the chosen range and
published as a chart-series payload for the
[SeriesChart plugin](../SeriesChart/README.md). Changing the range refetches.
Bus-only — no core imports.

## Behavior

- Listens to `plugin:fetch-timeseries:fetch` (`{ feature, layerId, latlng }`).
  Anything may emit it; the shipped emitter is a
  [Feature Popup](../FeaturePopup/) card action, see below.
- Layer has no `variables.timeseries` block → the request does **nothing**
  (no card, no fetch, no empty chart).
- Eligible request → the tool shows its card (it starts hidden) with Start
  and End instants seeded from the layer's own data range (its Data Time
  Extent, as core resolves it), clipped to the last year when it is longer,
  with an end in the future capped at the end of today, UTC. A side the layer
  leaves open comes from the mission time window, else from today and the
  year before it. The range is seeded once per layer; a pick on another layer
  reseeds it. The chart below names the feature; the card
  does not. It fetches the feature's series over that range and emits `seriesReady` with the
  `ChartSeriesPayload` itself as the (flat, unenveloped) event payload (see
  [`_shared/types/chartSeries.ts`](../_shared/types/chartSeries.ts)).
  Loading and failure (HTTP error, timeout, bad URL template, unusable
  response shape) show on the card; neither is an event. A failure also
  emits `seriesCleared`, so the previous chart never sits under an error.
- Changing the range refetches the same feature, 400 ms after the last
  change, and emits `seriesReady` again, so the chart replaces its card. A
  start past the end drags the end along, and the reverse. A layer whose URL
  takes no range gets the card with EXIT only.
- A new request aborts any in-flight fetch and replaces the chart (single
  `chartId: 'vector-timeseries'`). The chart stays until the next request
  replaces it, EXIT clears it, or a fetch fails. Fetches time out after 30
  seconds.
- EXIT on the card closes both surfaces: it emits `seriesCleared`, which
  takes the chart down, and hides this card. The next Timeseries press opens
  them again.
- Tool teardown (`destroy`) aborts any in-flight fetch and emits
  `seriesCleared` so no chart is left behind.

Events (under `plugin:fetch-timeseries:`): `seriesReady`, `seriesCleared`.

## The range on the URL

Services disagree on how a range is asked for, so the layer's URL says it.
The card's instants fill `{start}` and `{end}`, as `YYYY-MM-DDTHH:MM:SS` in
UTC with no zone suffix, wherever the URL puts them; the author writes the
service's own syntax around them. Two working forms:

OGC Features / STAC, a `datetime` interval:

```
...&datetime={start}Z/{end}Z
```

The VEDA dev features API, whose date columns are text and refuse
`datetime=` ("Must have timestamp typed column"), as a CQL2 text comparison:

```
...&filter=datetime >= '{start}' AND datetime <= '{end}'&filter-lang=cql2-text
```

A URL with neither placeholder fetches whatever the service returns, and the
card shows no Start/End inputs.

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

Place FetchTimeseries in the same panel as SeriesChart, listed just before
it, so the date card sits above the chart. Both start hidden.

## Layer configuration (`layer.variables.timeseries`)

In Configure this is the **Timeseries** row in the Time tab of a vector or
vector-tile layer's page. The fields write the block below.

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
  SeriesChart's Variable dropdown picks which one is visible and the card footer shows
  its unit.

Place FetchTimeseries and SeriesChart in a panel in that order (the chart's
default `sources` already includes `fetch-timeseries`), add FeaturePopup to
the mission's tools, click a station, press Timeseries on its card, then
narrow the dates to 2018–2019 and watch the chart redraw.
