# AOI Plugin — Blockers

Tracked per [PLUGIN-DEVELOPMENT-GUIDE.md](../../../../PLUGIN-DEVELOPMENT-GUIDE.md) §2 (blocker template) and [specs/012-aoi-plugin/plan.md](../../../../specs/012-aoi-plugin/plan.md) §11.

---

## [BLOCKER] IMapEngine has no drawing primitives

- **Date**: 2026-05-04
- **Status**: spec drafted, awaiting core implementation
- **Tracking**: full proposal in [specs/013-imapengine-drawing/spec.md](../../../../specs/013-imapengine-drawing/spec.md). Core work happens on a separate branch (e.g. `feat/imapengine-drawing`); plugin tasks P1–P7 in §5 of that spec resume on this branch once it merges.
- **Workaround in this plugin**: Render the Draw tab UI but pass `drawDisabled=true` to the component. The tab body shows "Drawing is not available on this map engine yet." Stays blocked until the core spec lands.

---

## [BLOCKER] `plugin:analysis:supportsLayer` request handler

- **Date**: 2026-05-04
- **What I needed**: An async request handler the AOI plugin can call to ask "does the currently active layer expose timeseries analysis?", driving whether the tooltip's `Analyze area` button is enabled.
- **Where I looked**: `src/essence/mmgisAPI/mmgisAPI.js` — no `plugin:analysis:*` handlers exist yet.
- **Why existing APIs don't suffice**: Whether a layer supports analysis is the Analysis plugin's concern, not core's. The plugin-development guide requires us to ask the Analysis plugin via the bus rather than reading layer config directly.
- **Proposed change** (for the **Analysis plugin team**, not core):
    Provide on the bus:

    ```ts
    mmgisAPI.provide(
        'plugin:analysis:supportsLayer',
        (layerName: string) => boolean
    )
    ```

    (Optional companion handler: `plugin:analysis:getSupportedLayers` -> `string[]` for batch checks.)
- **Workaround in this plugin**: Default `analyzeEnabled` to `true` when no `plugin:analysis:supportsLayer` handler is registered, and fall back to the Analysis plugin's own error state if the layer turns out to be unsupported. T5 stays blocked until the handler exists.

---

## [DEFERRED] Inspect-mode boundary-click event

- **Date**: 2026-05-04
- **Status**: Deferred — Inspect mode scope is not yet defined.
- **Note**: When this is picked up, evaluate whether the existing `feature:active` core event (verified present in `mmgisAPI`) is sufficient or whether a dedicated `boundary:click` event is needed. The Inspect tab currently renders a "Coming soon" placeholder.
