# Feature gaps in the lean deployment

Features full MMGIS provides that lean either drops or can only deliver through new work. Working list.

Lean does not host data of any kind. Features whose current implementation depends on local files either need an external substitute — typically STAC or another mission-owner-hosted service — or are dropped. Mission owners who want a capability are responsible for hosting the data behind it.

---

## Settled drops

Capabilities lean does not provide and is not building a substitute for. Documented here so the loss is clear.

- **In-admin data upload.** Datasets, geodatasets, mission assets, tile pyramids. Admins author mission configs by referencing external URLs only.
- **Python sidecars as part of MMGIS.** TiTiler, TiTiler-pgSTAC, STAC, tipg, and the `/veloserver` proxy. Missions point at external services for any capability these used to provide.
- **`Missions/` static file serving.** No per-mission on-disk asset tree; the admin serves no mission assets from disk.
- **`mmgis-stac` database.** Not created since the STAC sidecar isn't deployed.
- **Link shortener.** Not deployed.
- **Webhooks on Draw / Config events.** Not deployed.

---

## Open gaps

### 1. Time-windowed layers (`_time_` URL convention)

**What it does.** Layer URLs contain a `_time_` placeholder. The frontend's time slider substitutes a date; the admin's `Missions/` middleware resolves it to the closest-prior tile on disk. With `?composite=true`, sharp alpha-blends up to 100 time-tagged tiles in the requested window — most recent non-transparent pixel wins.

**Why lean breaks it.** No `Missions/` middleware and no local data, so the substituted URL has nothing to answer it.

**Options:**

- **A. Hide.** Time-windowed layers don't appear in lean missions. Real capability loss for missions whose value depends on time-scrubbing.
- **B. STAC-backed.** The mission owner uploads the source data to a temporal-aware external service (STAC + a tile server like TiTiler-pgSTAC). Frontend's `TimeControl_` is rewired to drive STAC queries instead of string substitution. STAC mosaicking sorted datetime-descending reproduces both the closest-prior and the alpha-composite behavior. Costs: data hosting is the mission owner's responsibility; one-time frontend rewrite; layer-config schema change.

---

More to be added.
