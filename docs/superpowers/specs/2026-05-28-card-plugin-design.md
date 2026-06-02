# Card Plugin — Design

**Issue:** NASA-IMPACT/MMGIS#103
**Date:** 2026-05-28
**Status:** Approved (design); implementation pending

## Summary

Add a **Card** plugin that renders a configurable list of cards in a sidebar
panel. Each card shows a square-cropped image, a title, a subtitle, and links
to a URL. Mission admins manage the cards from the Configure page, including
**uploading images** — a capability the Configure SPA does not have today.

The work has three parts:

1. A **modern (TSX/React) Card tool** under `src/essence/Tools/Card/`, following
   the `LayerManager` pattern (event-bus only, `createRoot`, `targetId`).
2. A new reusable **`upload` config field type** in the Configure SPA so admins
   can upload an image instead of typing a path.
3. A small **CardPlugin backend module** with one `busboy` upload route that
   writes images under `Missions/<mission>/CardPlugin/uploads/`.

The card *data* itself is stored as tool variables in the mission config and
rides the existing Config save/load path — the only new backend surface is the
file upload.

## Context / key findings

- **Modern tool reference:** `src/essence/Tools/LayerManager/` (contributor
  slesaad). TSX + React 19 `createRoot`, mounts into a `targetId` container,
  communicates exclusively through the `window.mmgisAPI` event bus
  (`request`/`provide`/`on`/`emit`), with thin `adapters/` wrappers and pure
  `lib/` presentational components. `MODERN_TOOL_PATTERN.md` documents the
  checklist.
- **Tool discovery:** `API/updateTools.js` globs `src/essence/Tools/*` (plus
  `*Plugin-Tools*`/`*Private-Tools*`) for any dir with a `config.json` and writes
  `src/pre/tools.js`. No central registration needed.
- **Backend module discovery:** `API/setups.js` loads `API/Backend/*/setup.js`
  (plus `*Plugin-Backend*`). `setup.onceInit(s)` registers routes via
  `s.app.use(s.ROOT_PATH + "/api/...", s.ensureUser(), s.stopGuests, router)`
  (see `API/Backend/Draw/setup.js`).
- **Uploads:** the repo already uses `busboy` (`API/Backend/Datasets/routes/datasets.js`).
- **Static serving:** `scripts/server.js` serves `/Missions` statically, so
  files written under `Missions/<mission>/…` are immediately web-accessible.
- **Configure field types:** `configure/src/core/Maker.js` renders config fields
  by `type` (`text`, `dropdown`, `objectarray`, `colorpicker`, `checkbox`, …).
  Each field persists via `updateConfiguration(field, value)`. **There is no
  file/image upload field type** — images are always typed URL/paths. This is
  the capability gap the `upload` field type fills. (The `"image"` case in
  `validators.js` is a layer *type*, unrelated to upload.)

## Architecture

Three independent, separately testable units:

| Unit | Location | Responsibility |
|---|---|---|
| Card tool (frontend) | `src/essence/Tools/Card/` | Render the card list in the sidebar from tool vars. Event-bus only. |
| `upload` field type | `configure/src/core/Maker.js` (+ upload component) | File picker → POST → store returned mission-relative path. |
| CardPlugin backend | `API/Backend/CardPlugin/` | One `busboy` route saving images under `Missions/<mission>/CardPlugin/uploads/`. |

### Data model

Card tool variables, stored in mission config:

```jsonc
"variables": {
  "cards": [
    {
      "image":    "CardPlugin/uploads/<uuid>.png", // mission-relative path
      "title":    "Seeing Beyond the Flames…",
      "subtitle": "Wildfire impacts, Southern California",
      "linkUrl":  "https://…"
    }
  ]
}
```

In `config.json` this is an `objectarray` whose `image` sub-field is `type: "upload"`
and whose `title`/`subtitle`/`linkUrl` sub-fields are `type: "text"`. The stored
`image` value is a mission-relative path — identical in shape to existing typed
paths, so it stays backward-compatible (a path can still be pasted).

### Data flow

**Authoring (Configure page):**
1. Admin opens the Card tool config → an `objectarray` of cards.
2. For a card's image, the `upload` field offers a file picker.
3. On select, the field POSTs the file (multipart) to the upload route with the
   current mission, receives `{ path }`, and calls `updateConfiguration(field, path)`.
4. Admin saves the mission config (existing flow) — the `cards` array persists.

**Runtime (map app):**
1. `CardTool.make(targetId)` mounts the React adapter via `createRoot`.
2. The adapter reads `cards` via `mmgisRequest('tool:getVars', 'card')`.
3. It resolves each `image` mission-relative path to an absolute
   `/Missions/<mission>/…` URL (via an existing event-bus handler if available,
   else a small added `provide` — kept import-decoupled; exact handler verified
   during implementation).
4. Renders the list: square `object-fit: cover` image (the automatic crop),
   title, subtitle, whole card links to `linkUrl` (`target="_blank"`,
   `rel="noopener noreferrer"`).

## Component detail

### Backend — `API/Backend/CardPlugin/`

- `setup.js` — `onceInit(s)` registers the router at
  `s.ROOT_PATH + "/api/cardplugin"` behind `s.ensureUser()` + `s.stopGuests`
  (same posture as mission-config editing; admin-gated).
- `routes/upload.js` — `POST /upload?mission=<name>`, multipart via `busboy`.
  - Validates mission name (reject path traversal / non-existent mission dir).
  - Accepts MIME `image/(png|jpeg|webp|gif)` with matching extension whitelist
    (png, jpg, jpeg, webp, gif). **SVG excluded** (stored-XSS vector).
  - Size cap ~5 MB; aborts/cleans up on overflow.
  - Writes to `Missions/<mission>/CardPlugin/uploads/<uuid>.<ext>`
    (dir created if missing).
  - Responds `{ status: "success", path: "CardPlugin/uploads/<uuid>.<ext>" }`
    or a JSON error (`400` bad input, `500` write failure).

### Configure — `upload` field type

- New `case "upload"` in `configure/src/core/Maker.js`: file
  `<input accept="image/png,image/jpeg,image/webp,image/gif">`, a thumbnail
  preview of the current value, and a clear button.
- On select: POST to `/api/cardplugin/upload` with the active mission; on success
  `updateConfiguration(forceField || com.field, returnedPath, layer)`; on failure
  show an inline error and keep the prior value.
- Functions inside `objectarray`, so each card row gets its own uploader.
- Reuses the existing config-value plumbing — no change to how values save/load.

### Frontend — `src/essence/Tools/Card/`

Mirrors `LayerManager`:

- `CardTool.tsx` — lifecycle object (`initialize`, `make(targetId)`, `destroy`,
  `getUrlString`), `createRoot` mount/unmount, `made`/`targetId` state, cleanups.
- `MMGISCardAdapter.tsx` — `useMMGISToolVars('card')` to read `cards`; renders
  presentational `lib/` components; bus-agnostic components.
- `lib/CardList.tsx`, `lib/Card.tsx` — pure presentational; `lib/styles/*.scss`.
- `adapters/mmgisAPI.ts`, `adapters/useMMGISToolVars.ts` — thin bus wrappers
  (same shape as LayerManager's).
- `config.json` — `name: "Card"`, `paths`, `metadata`
  (`modernLayoutSupport: true`, vertical, `compatiblePositions: ["left","right"]`),
  and the `config.rows` schema (the `cards` `objectarray`).
- Styling from the Figma CSS: Public Sans; card `#F2F5F7` bg / `1px #DFE1E2`
  border / 16px padding / 12px gap; image 65×65 `object-fit: cover`; title
  `#0D313D` 14px; subtitle/label `#565C65` 12px; link label `#005EA2` 12px.

## Error handling

- **Upload route:** reject non-image / oversize / bad-mission with JSON 4xx;
  write errors → 500; guests blocked by `stopGuests`.
- **Upload field:** inline error on failure, prior value retained; uploading
  state shown while in flight.
- **Card tool:** guard unavailable `tool:getVars` at startup (as LayerManager
  does); no cards → empty panel; broken/missing image path → hidden or
  placeholder, never a crash.

## Security

- Auth: admin-gated (`ensureUser` + `stopGuests`; matches mission-config editing).
- Filename: server-generated `<uuid>.<ext>` — never trust the client filename.
- Mission param validated against the real `Missions/` dir; no `..` traversal.
- MIME + extension whitelist (raster only); SVG excluded.
- Size cap enforced server-side.

## Testing

- **Backend (Jest):** valid image saved + correct path returned; non-image
  rejected; guest rejected; path-traversal mission rejected; oversize rejected.
- **Frontend (Playwright, repo suite):** `Card`/`CardList` render title,
  subtitle, link, and square image; empty-state renders nothing.
- **Manual:** configure a mission with 2–3 cards incl. real uploads; confirm the
  sidebar matches the Figma.

## Out of scope (future work)

- S3 upload backend (issue notes this as future; the upload route is the seam
  where storage backend would swap).
- Server-side crop/resize (current approach is CSS `object-fit: cover`).
- Drag-reorder beyond what the `objectarray` UI already provides.

## Open implementation details (resolved during planning)

- Exact event-bus handler used to resolve a mission-relative path to an absolute
  `/Missions/<mission>/…` URL from the tool without importing `L_`.
- Exact middleware/permission used by mission-config save, to match it on the
  upload route.
