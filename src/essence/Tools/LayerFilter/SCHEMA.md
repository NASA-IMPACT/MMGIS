# LayerFilter — Data Schema (Decision Record)

> Status: agreed working design — **up for team review (#221)**.
> Implementation tracked in #219 (foundation) and #220 (themes UI),
> children of #164. Review as a PR: comment inline on anything here.
> Applies to the two-plugin pair: **LayerFilter** (panel) and
> **LayerFilterThemes** (rail). Each configures only what it renders and they
> join on theme `id` — see §5.

## 1. The model

```
SECTOR values ──< on LAYER
HAZARD values ──< on LAYER            (dataset is *relevant to* a hazard)
HAZARD values ──< on ACTIVATION       (event *was* a hazard — different fact, same range)
ACTIVATION ──< ACTIVATION_LAYER >── LAYER   (M:N, association carries attributes)
```

- **LAYER** — an MMGIS layer. Carries only *intrinsic* tags.
- **ACTIVATION** — a disaster event. A **GeoJSON Feature**: geometry +
  time range + properties. The catalogue is a FeatureCollection.
- **ACTIVATION_LAYER** — the association, with pair-dependent attributes
  (`defaultOn`, `opacity`, per-pair `view` override). Lives inline as
  `activation.properties.layers[]`.
- **No LOCATION entity anywhere.** Location is geometry, full stop (§3).
- **No vocab tables.** Tag values are display-ready strings
  (`"Wildfire"`, not `"wildfire"` + label map). Engine matches
  case-insensitively so casing typos merge instead of forking a category.

## 2. Stored vs derived

Stored fields are only facts with no other source. Everything else is
computed:

| Value | Derived from | Rule |
| --- | --- | --- |
| Year(s) | `start_datetime`/`end_datetime` | full span — Dec 2024–Feb 2025 matches 2024 **and** 2025 |
| ACTIVE badge | `end_datetime` | `null/absent or >= now` |
| Fly-to camera | activation `geometry` | fit `bbox(geometry)`; per-pair `view` override wins |
| Location | activation `geometry` | query-time geocode intersection (§3) |
| Facet options (hazard, sector, year) | the data | distinct values across layers / catalogue — **never enumerated in config** |
| Option counts | the data | same pass as options |

## 3. Location = geocode search

The Location control is a **geocode search box** (geocoding is already in
use in the MapControl tool — same external-service pattern, provider set
in config, never hardcoded):

- User types a place → geocoder returns candidates with geometry
  (polygons for admin areas) → filter is
  `intersects(activation.geometry, chosen.geometry)`.
- Activations therefore store **no location field at all** — geometry is
  the single spatial fact.
- Engine-wise this is a **predicate facet** (a test rows pass/fail) vs the
  enumerated facets (dropdowns). Cascade works outward (a chosen place
  narrows hazards/years/activations) but not inward (free text has no
  options to grey out).
- The facet *type* is config — `"geocode"` today; `"derived-regions"`
  (boundaries-file intersection) and `"values"` (authored strings) remain
  as alternative types with the identical schema, since geometry stays the
  source of truth in all three.

## 4. What a layer author writes (`layer.properties`)

```json
{
    "key": "modis-truecolor",
    "sector": ["Public Health", "Energy"],
    "hazard": ["Wildfire", "Flood"]
}
```

- Arrays always; display-ready values.
- `key` only if an activation references this layer — a **stable id**,
  because the MMGIS layer `name` is an ingest-generated UUID. Loader
  resolves key → UUID at runtime and **warns on dangling references**.
- Deleted vs the old format: `theme` (membership is derived from matching
  a theme's filters), `location`, `year` (facts about the event, not the
  layer — storing them on layers creates false combinations: MODIS
  serving CA-2025 and TX-2024 would wrongly match "CA 2024").

## 5. What the app builder writes (tool config)

**Config ownership: each plugin configures only what it renders.** The rail
draws the theme entries and owns which one is selected; the panel draws each
theme's filters. They join on theme `id`. So "change the rail's icon" is an
edit to the tool named LayerFilterThemes, not to LayerFilter.

The panel's two fields are separate because they have different change
cadences (themes: set once; catalogue: edited every disaster), different
authors, and the catalogue is the part expected to move to a hosted URL/STAC
later (a third `Catalog URL` field will take precedence over the JSON when
set).

### Field 0 — Rail entries (JSON) — on the **LayerFilterThemes** tool

```json
{
    "defaultThemeId": "need",
    "themes": [
        { "id": "need",   "label": "Need",   "icon": "satellite-variant" },
        { "id": "hazard", "label": "Hazard", "icon": "flash-outline" },
        { "id": "event",  "label": "Event",  "icon": "calendar-range" }
    ]
}
```

Drift is the accepted cost of the split: a rail id with no matching panel
theme warns and shows an empty panel; a panel theme with no rail entry is
simply unreachable. A future builder that wires rail→panel visually can
diff the two id sets and offer to sync them.

### Field 1 — Themes & filters (JSON) — on the **LayerFilter** tool

```json
{
    "themes": [
        {
            "id": "need",
            "title": "Need",
            "description": "Filter by sector to explore Earth-science datasets relevant to your operational needs.",
            "filters": [
                { "id": "sector", "label": "Sector", "property": "sector", "multi": true, "allLabel": "All Sectors" }
            ]
        },
        {
            "id": "hazard",
            "title": "Hazard",
            "description": "Explore datasets by hazard type.",
            "filters": [
                { "id": "hazard", "label": "Hazard", "property": "hazard", "allLabel": "All Hazards" }
            ]
        },
        {
            "id": "event",
            "title": "Event",
            "description": "Filter the activation catalogue by hazard, location and year.",
            "catalog": "activations",
            "filters": [
                { "id": "hazard", "label": "Hazard Type", "property": "hazards", "from": "catalog", "allLabel": "All Hazards" },
                { "id": "location", "label": "Location", "from": "catalog", "type": "geocode" },
                { "id": "year", "label": "Year", "from": "catalog", "derived": "datetimes", "allLabel": "All Years" },
                { "id": "activation", "from": "catalog", "isEntry": true }
            ]
        }
    ],
    "geocoder": { "url": "<same service MapControl uses>", "provider": "nominatim" }
}
```

Note: **no `options` arrays anywhere** — dropdown contents and counts are
derived from the data (§2).

### Field 2 — Activation catalog (JSON) — a plain GeoJSON FeatureCollection

```json
{
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "id": "ca-wildfires-2025",
            "geometry": { "type": "Polygon", "coordinates": [[[-124.4, 32.5], [-114.1, 32.5], [-114.1, 42.0], [-124.4, 42.0], [-124.4, 32.5]]] },
            "properties": {
                "title": "California Wildfires",
                "hazards": ["Wildfire"],
                "start_datetime": "2025-01-05T00:00:00Z",
                "end_datetime": "2025-03-31T00:00:00Z",
                "layers": [
                    { "key": "fire-extent", "defaultOn": true },
                    { "key": "active-fire-detections", "defaultOn": true, "opacity": 0.8 },
                    { "key": "modis-truecolor", "defaultOn": false }
                ]
            }
        },
        {
            "type": "Feature",
            "id": "tx-flooding-2024",
            "geometry": { "type": "Point", "coordinates": [-97.7, 30.3] },
            "properties": {
                "title": "Texas Flooding",
                "hazards": ["Flood"],
                "start_datetime": "2024-04-10T00:00:00Z",
                "end_datetime": null,
                "layers": [
                    { "key": "flood-extent", "defaultOn": true },
                    { "key": "modis-truecolor", "defaultOn": false, "view": { "center": [-97.7, 30.3], "zoom": 9 } }
                ]
            }
        }
    ]
}
```

- STAC field names (`start_datetime`/`end_datetime`) on purpose — an
  activation is ~a STAC Item, so a future STAC-backed catalogue is a
  loader swap, not a migration.
- `end_datetime: null` ⇒ ACTIVE.
- The `layers[]` entries are the ACTIVATION_LAYER association rows.

## 6. Genericity (Air4US etc.)

Nothing app-specific lives in code:

- Facet property names (`sector`, `hazard`) are config strings — another
  app uses `pollutant`, `station_type`.
- `catalog` is a generic concept — "activations" is this app's instance;
  Air4US defines e.g. an "episodes" FeatureCollection with the same shape
  (title, tags, datetimes, geometry, layers). The engine never contains
  the word "activation".
- Engine world-model: *layers with properties; catalogue features with
  properties + datetimes + geometry + layer references; facets
  (enumerated or predicate) reading from one or the other.*

## 7. Filter output mechanism (decided, code recovered)

The filter never touches map visibility. It writes one piece of core
state and everything downstream re-renders reactively:

```
LayerFilter                     core (Layers_.js)              LayerManager
    │  layers:setListed({updates})  │                               │
    ├──────────────────────────────>│  L_.layers.listed[uuid]=bool  │
    │                               ├── emit layers:listedChanged ─>│
    │                               │                               ├─ re-fetch, skip
    │                               │<── layers:getListed ──────────┤  listed === false
```

- `L_.layers.listed` — uuid → bool, **absent = listed** (no boot
  initialization needed), runtime-only, deliberately outside `configData`
  so config re-parses don't wipe it. Cleaned up on layer removal.
- `layers:setListed({ updates, source })` — bulk write (the filter sets
  its whole result in one call). `source` is accepted-but-unused,
  reserved for multi-writer arbitration.
- Orthogonal flags, by design: `layers.on` = "drawn on the map";
  `layers.listed` = "shown in layer lists". The filter writes only the
  second.
- Implementation exists (recovered from stash; 803/803 tests green):
  core state + both channels + change emit, LayerManager skip,
  LayerFilter writing the complement map via `buildListedUpdates`,
  gated on first user interaction (boot never narrows the list).
- That gate rides on the rail's broadcast payload: the rail announces its
  boot-time default as `{ themeId, initial: true }` and only user clicks
  omit the flag. Making it explicit (rather than "the rail must not emit its
  default", enforced by a comment) means a replacement rail can't silently
  reintroduce boot-time narrowing.
- Event name `layer:listedChange` (singular family) is **deliberate** —
  chosen to stay visually distinct from the existing `layers:listChanged`
  (layer add/remove), which a plural `layers:listedChanged` would collide
  with at a glance.

## 8. Still open

1. **The ghost-layer problem (next discussion).** A layer visible on the
   map (`on = true`) gets filtered out (`listed = false`): the map shows
   pixels the panel no longer lists. Options: (a) accept it; (b) filter
   also toggles excluded-but-on layers off — scope change, filter starts
   mutating the map; (c) LayerManager renders excluded-but-on layers in a
   separate "active but filtered out" stub section — honest, reversible,
   keeps the filter list-only.
2. **Multi-writer convention** — `listed` is single-writer by convention
   for now; `source` param exists for arbitration if a second writer
   appears.
3. Is activation→hazard genuinely M:N in the real catalogue? (Modeled M:N;
   collapses to single-valued if the program always assigns one.)
4. Does `sector` ever attach to activations (would link Need ↔ Event)?
5. Selection side effects — deliberate yes/no each: toggle `defaultOn`
   layers; fly-to policy (first `defaultOn` layer vs explicit focus);
   set TimeControl to the activation's date range.
6. Cascade fine print (facet options rule, invalidation, selection state
   across themes) — agreed in principle (each facet computed from rows
   passing every *other* facet; auto-clear on invalidation; per-theme
   selection state), to be locked when the engine is specced.
