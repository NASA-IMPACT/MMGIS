This is an LLM artifact — a per-PR implementation doc derived from [`./00-overview.md`](./00-overview.md). Draft; verify against current code before acting.

# PR 6 — Configure SPA lean polish

**Depends on:** PR 3 (uses the `DEPLOYMENT_MODE` flag PR 3 plumbs). **Blocks:** none.

**Goal:** In `lean` mode, hide the one Configure affordance that reaches a dropped helper service (the populate-from-COG button) while keeping the External Service URL fields that point layers at external sidecars, and confirm the APIs cards already render inactive. (STAC write actions are optional defense-in-depth — the STAC page is already unreachable in lean.)

> **Explicitly NOT touched: the mission "Upload Config.JSON" feature.** The Home-tab `UploadConfigModal` reads a config JSON **client-side** (`FileReader` → `JSON.parse`) and saves it via `/api/configure` (a **Keep** module in lean). It does *not* use the #103 Upload module or `Missions/`, so it stays fully functional. It only shares the `UploadIcon` with the STAC row-actions below — that icon overlap is the only relationship; PR 6 must not gate it.

## In plain English

In lean, several buttons in the admin still assume helper services are present that aren't. An admin could click one and get a confusing failure, or quietly build a layer that a published dashboard can't actually draw. This PR hides just those dead buttons so the admin interface stays honest about what it can do.

Crucially, it does *not* remove the admin's ability to point layers at external services — that is exactly how lean missions get their data. The fields where an admin types an external service address stay fully visible. Only the convenience button that tries to auto-fill those fields by phoning a local service goes away, because that local service isn't there.

The STAC catalog page has similar data-writing buttons, but in lean that whole page is already hidden — its sidebar tab only appears when the STAC service is switched on, which it never is in lean — so gating those individual buttons is just belt-and-suspenders, optional rather than load-bearing. A couple of related surfaces — the service-status cards and a layer type that leans on a dropped service — are simply double-checked or given a gentle save-time warning, not removed. None of this affects the admin's own mission-authoring tools: importing a mission's Config.JSON, editing layers, and pointing them at external services all stay fully available in lean.

## Scope / files

| File | Change | Notes (verified against code) |
|---|---|---|
| `configure/src/core/Maker.js` | Hide the COG/XML "populate" button in lean by gating the render of its action branch. It's the `"button"` render branch (`case "button":` ~L561) whose click runs `com.action === "tile-populate-from-x"` (~L571) → `tilePopulateFromX(...)`. Return `null` (render nothing) for that branch when `window.mmgisglobal.DEPLOYMENT_MODE === 'lean'`. **Do NOT route this through `isDisabled` or a `disabled` prop** — see Notes. | **Maker.js line numbers here are approximate — anchor on the action-name string `tile-populate-from-x`, not line numbers.** Verified: button render ~L561–568; action branch ~L571; `tilePopulateFromX` at ~L1860 hits `${window.location.origin}/titiler/cog/info?url=...` (~L1885) **and** fetches `tilemapresource.xml` from the mission path `Missions/.../` (~L1916). **`isDisabled` is the WRONG anchor:** it's `isPlanetaryProjectionComponent && isTitilerDisabled` (~L396), true only for projection components (`projection.tilematrixset` / `coordinates-populate-from-tmset`), so it never affects this button. **Duplicate-prop trap:** the button has both `disabled={isDisabled}` (~L566) and `disabled={disabled}` (~L568); JSX keeps the last, so any `disabled` you set via `isDisabled` is silently overridden. Hide the button outright. The literal "Populate from cog" string is **not** in source — anchor on the action name. |
| `configure/src/metaconfigs/layer-tile-config.json` | **No change.** Keep the `titiler-url` sourceType and the "External Service URLs" section visible — these are how lean points layers at external sidecars (#63). | Verified: `sourceType` options include `titiler-url` (L60); "External Service URLs" section at L184. Leave intact. |
| `configure/src/pages/STAC/STAC.js` | **Optional / defense-in-depth, not load-bearing.** The whole STAC page is already unreachable in lean (see Notes), so gating its row actions is redundant. If done anyway, gate the write actions on `DEPLOYMENT_MODE === 'lean'`: "New Collection", per-row "Import Items", "Edit Collection", and "Delete"; leave "Export" visible. | Verified: STAC page is reachable **only** via the STAC nav button (Panel.js L343), itself gated on `WITH_STAC === "true"`; PR 2 forces `WITH_STAC=false` in lean → the page never renders. Row actions present: "New Collection" ~L301; "Import Items" (`UploadIcon`) L573; "Edit Collection" (`EditIcon`) L537; "Delete" (`DeleteForeverIcon`) ~L611; "Export" (`DownloadIcon`) L584. There is no separate "Append" button — see notes below. |
| `configure/src/pages/APIs/APIs.js` | **Verify only** — no code change expected. Confirm each card already renders inactive when its `WITH_*` flag is false in lean. | Verified: each card's `active` keys on `window.mmgisglobal.WITH_* === "true"` (L39/L49/L59/L69); render uses `apiCard.active ? c.card : c.cardInactive` (L195). PR 2 forces the `WITH_*` flags false in lean, so cards are already inactive. |
| `configure/src/components/Tabs/Layers/Modals/LayerModal/LayerModal.js` | Optional, non-blocking: at save-time in lean, warn if a velocity layer's URL points at a dropped sidecar path. Do not block the save. | See notes below for the correct path. The velocity `url` field is `field: "url"` (layer-velocity-config.json L63); there's no Configure-side break, only a runtime one, so this is a soft warn at most. |
| `configure/src/metaconfigs/layer-velocity-config.json` | No change. | Verified: velocity config has a generic `url` field; no `veloserver` literal. Runtime concern only. |

## Implementation steps

1. In `Maker.js` `case "button":` (~L561; re-grep `tile-populate-from-x`, line numbers are approximate), gate the render of the `tile-populate-from-x` action branch on the deployment mode: when `window.mmgisglobal.DEPLOYMENT_MODE === 'lean'`, render nothing (return `null`) for that branch so the button is absent. **Do not use a `disabled` prop** — the existing `disabled={isDisabled}` (~L566) is already dead-overridden by `disabled={disabled}` (~L568), and `isDisabled` (~L396) never applies to this button anyway. Hiding the whole button is correct: it's broken via two paths in lean — the `titiler/cog/info` call (~L1885) and the non-titiler `tilemapresource.xml` fetch from the gated `Missions/` path (~L1916). Leave all External Service URL inputs untouched.
2. In `APIs.js`, confirm (no edit) that cards render `cardInactive` when their `WITH_*` flag is false; add this as a verification step rather than a change.
3. (Optional, redundant) In `STAC.js`, gate the write actions on `DEPLOYMENT_MODE !== 'lean'` only as belt-and-suspenders — the STAC page is already unreachable in lean (`WITH_STAC=false` hides the nav button, Panel.js L343), so this changes nothing user-visible.
4. (Optional) In `LayerModal.js`, add a non-blocking save-time warning for velocity layers whose URL looks like a dropped sidecar path in lean.

## Verification

- `MMGIS_DEPLOYMENT_MODE=lean`: the COG populate button is **not present** in the tile-layer editor; the External Service URL fields and the `titiler-url` sourceType remain selectable and editable.
- `MMGIS_DEPLOYMENT_MODE=lean`: the STAC nav button is absent (PR 2 forces `WITH_STAC=false`), so the STAC page is unreachable — no STAC write actions can be triggered.
- `MMGIS_DEPLOYMENT_MODE=lean` (with PR 2's flag forcing): the STAC/TiTiler/TiTiler-PgSTAC/TiPg cards on the APIs page render inactive.
- `MMGIS_DEPLOYMENT_MODE=full` (or unset): every button, field, and card behaves exactly as today.
- (If implemented) saving a velocity layer with a sidecar-style URL in lean surfaces a non-blocking warning and still saves.

## Rollback

Revert the `Maker.js` edit (and any optional `STAC.js` / `LayerModal.js` changes); `full` is the default so existing behavior is unaffected.

## Implementation notes & gotchas

- **LayerModal path.** The file is `configure/src/components/Tabs/Layers/Modals/LayerModal/LayerModal.js`.
- **STAC row-action gating is mostly dead code in lean.** The STAC page is reachable only through the STAC nav button (Panel.js L343), which renders only when `WITH_STAC === "true"`; PR 2 forces `WITH_STAC=false` in lean, so the page never mounts and none of its actions can fire. Gating individual row actions is therefore redundant defense-in-depth — optional, not load-bearing. For the record, the row write affordances are "New Collection" (~L301), "Import Items" (`UploadIcon`, L573), "Edit Collection" (`EditIcon`, L537), and "Delete" (`DeleteForeverIcon`, ~L611); read-only "Export" is L584. There is no separate "Append" button.
- **`isDisabled` is the wrong anchor for the COG button.** `isDisabled = isPlanetaryProjectionComponent && isTitilerDisabled` (Maker.js ~L396) is true only for projection components, never for the `tile-populate-from-x` button — so disabling via it ships a no-op. Worse, the button carries duplicate `disabled` props (`disabled={isDisabled}` ~L566, then `disabled={disabled}` ~L568); JSX keeps the last, silently discarding anything set via `isDisabled`. Gate the **render** of the action branch on `DEPLOYMENT_MODE === 'lean'` instead. (Maker.js line numbers are approximate — re-grep the anchors.)
- **No "Populate from cog" string in source.** Anchor on `com.action === "tile-populate-from-x"` (~L571) and the `tilePopulateFromX` calls — `/titiler/cog/info` (~L1885) and the `tilemapresource.xml` fetch from `Missions/` (~L1916).
- **APIs cards already correct.** No edit needed; the `active`/`cardInactive` wiring (L195) already keys on the `WITH_*` flags PR 2 forces false in lean. Verification-only.
