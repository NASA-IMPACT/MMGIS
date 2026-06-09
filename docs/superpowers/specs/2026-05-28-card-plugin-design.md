# Card Plugin — Design

**Issue:** NASA-IMPACT/MMGIS#103
**Date:** 2026-05-28 (revised post-implementation to match as-built code)
**Status:** Implemented; in review

## Summary

Add a **Card** plugin that renders a configurable list of cards in a sidebar panel. Each card shows a square-cropped image, a title, a subtitle, and links to a URL. Mission admins manage the cards from the Configure page, including **uploading images** — a capability the Configure SPA did not have before.

The work has three parts:

1. A **modern (TSX/React) Card tool** under `src/essence/Tools/Card/`, following the `LayerManager` pattern (event-bus only, `createRoot`, `targetId`).
2. A new reusable **`upload` config field type** in the Configure SPA so admins can upload an image instead of typing a path.
3. A **generic, plugin-agnostic image-upload core module** at `API/Backend/Upload/`, exposing a single `busboy` upload endpoint (`POST /api/upload`) that any caller — plugin or core — reaches over the API. The Card plugin has no backend code of its own; it just calls this generic endpoint with `subdir=CardPlugin`.

The card *data* itself is stored as tool variables in the mission config and rides the existing Config save/load path — the only new backend surface is the generic file upload.

## Context / key findings

- **Modern tool reference:** `src/essence/Tools/LayerManager/` (contributor slesaad). TSX + React 19 `createRoot`, mounts into a `targetId` container, communicates exclusively through the `window.mmgisAPI` event bus (`request`/`provide`/`on`/`emit`), with thin `adapters/` wrappers and pure `lib/` presentational components. `MODERN_TOOL_PATTERN.md` documents the checklist.
- **Tool discovery:** `API/updateTools.js` globs `src/essence/Tools/*` (plus `*Plugin-Tools*`/`*Private-Tools*`) for any dir with a `config.json` and writes `src/pre/tools.js`. No central registration needed.
- **Backend module discovery:** `API/setups.js` loads `API/Backend/*/setup.js` (plus `*Plugin-Backend*`). `setup.onceInit(s)` registers routes via `s.app.use(...)`. The Upload module mounts behind `s.ensureAdmin()` (see Component detail below), matching the authorization posture of the Config write routes in `API/Backend/Config/setup.js`.
- **Uploads:** the repo already uses `busboy` (`API/Backend/Datasets/routes/datasets.js`).
- **Static serving:** `scripts/server.js` serves `/Missions` statically, so files written under `Missions/<mission>/…` are immediately web-accessible.
- **Configure field types:** `configure/src/core/Maker.js` renders config fields by `type` (`text`, `dropdown`, `objectarray`, `colorpicker`, `checkbox`, …). Each field persists via `updateConfiguration(field, value)`. **There was no file/image upload field type** — images were always typed URL/paths. This is the capability gap the `upload` field type fills. (The `"image"` case in `validators.js` is a layer *type*, unrelated to upload.)

## Architecture

Three independent, separately testable units:

| Unit | Location | Responsibility |
|---|---|---|
| Card tool (frontend) | `src/essence/Tools/Card/` | Render the card list in the sidebar from tool vars. Event-bus only. |
| `upload` field type | `configure/src/core/Maker.js` (+ `UploadField` component + `upload.js` caller) | File picker → POST → store returned mission-relative path. Plugin-agnostic: the upload `subdir` comes from the field's config. |
| Upload core module | `API/Backend/Upload/` | One generic `busboy` route saving images under `Missions/<mission>/<subdir>/uploads/`. Plugin-agnostic. |

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

In `config.json` this is an `objectarray` whose `image` sub-field is `type: "upload"` and whose `title`/`subtitle`/`linkUrl` sub-fields are `type: "text"`. The stored `image` value is a mission-relative path — identical in shape to existing typed paths, so it stays backward-compatible (a path can still be pasted). Note the stored value keeps the `CardPlugin/` prefix even though the upload backend is now generic: the card frontend uploads with `subdir=CardPlugin`, so the server writes to `Missions/<mission>/CardPlugin/uploads/` and returns `CardPlugin/uploads/<uuid>.<ext>` — unchanged from the original design.

### Data flow

**Authoring (Configure page):**
1. Admin opens the Card tool config → an `objectarray` of cards.
2. For a card's image, the `upload` field offers a file picker.
3. On select, the field POSTs the file (multipart) to the generic upload route (`POST /api/upload?mission=<name>&subdir=CardPlugin`) with the current mission, receives `{ status: "success", path }`, and calls `updateConfiguration(field, path)`.
4. Admin saves the mission config (existing flow) — the `cards` array persists.

**Runtime (map app):**
1. `CardTool.make(targetId)` mounts the React adapter (`MMGISCardAdapter`) via `createRoot`.
2. The adapter waits for the `tool:getVars` handler to register (via `useMMGISHandlerReady('tool:getVars', …)`), then calls `getCardData()`, which reads `cards` via `mmgisRequest('tool:getVars', 'card')` and the mission path via `mmgisRequest('app:getMissionPath')`.
3. `buildCardData()` resolves each `image` mission-relative path to a renderable URL via `resolveImageUrl` (mission-relative paths are prefixed with the mission path; absolute/`data:`/root-relative URLs pass through), and normalizes each `linkUrl` via `resolveLinkUrl` (see Component detail).
4. Renders the list: square `object-fit: cover` image (the automatic crop), title, subtitle, whole card links to the resolved `linkUrl` (`target="_blank"`, `rel="noopener noreferrer"`).

## Component detail

### Backend — `API/Backend/Upload/` (generic, plugin-agnostic)

- `setup.js` — `onceInit(s)` mounts the router at `s.ROOT_PATH + "/api/upload"` behind `s.ensureAdmin()` (plus `s.checkHeadersCodeInjection` and `s.setContentType`). `ensureAdmin` requires an authenticated admin/lead session (permission `"111"`/`"110"`) and does **not** auto-pass under `AUTH=off`. The router is created with `routePath: '/'` so the POST handler sits at the mount point itself (`/api/upload`) rather than `/api/upload/upload`.
- `uploadRouter.js` — `createUploadRouter({ allowedMimeToExt, maxFileBytes, routePath })` returns an Express router with one handler: `POST <routePath>?mission=<name>&subdir=<name>`, multipart via `busboy`.
  - Validates `mission` and `subdir` query params with `isValidMission`/`isValidSubdir` (both are the same single-safe-segment check: reject empty, `..`, path separators, and pure-dot names). Bad/missing values → `400`.
  - The mission's folder need not exist yet (configs imported via "Upload Config.JSON" don't materialize a `Missions/<mission>/` dir); since the name is path-traversal-validated and the route is admin-gated, the uploads path is created on demand (`fs.mkdirSync(..., { recursive: true })`).
  - Accepts MIME types per the mount-level allow-list (`IMAGE_MIME_TO_EXT`) with a server-mapped extension; an unsupported type → `400 "Unsupported image type"`.
  - Size cap 5 MB (default); on overflow the partial file is deleted and the route responds `413 "Image exceeds size limit"`.
  - Writes to `Missions/<mission>/<subdir>/uploads/<uuid>.<ext>` (server-generated UUID filename, never the client filename).
  - Responds `{ status: "success", path: "<subdir>/uploads/<uuid>.<ext>" }` (mission-relative) only from the write stream's `finish` event — i.e. once bytes are flushed to disk, to avoid racing `busboy`'s `close`. Errors respond `{ status: "failure", message }` with `400` (bad input / no file) or `500` (write failure).
- `validate.js` — pure helpers: `IMAGE_MIME_TO_EXT`, `extensionForMime`, `isSafePathSegment`, `isValidMission`, `isValidSubdir`.
  - The allow-list is **png, jpeg, webp, gif, and svg**. SVG is **allowed**: uploaders are trusted admins, and cards render images via `<img src>`, which does not execute scripts embedded in an SVG. The residual risk is limited to someone opening the raw asset URL directly (which would render the SVG as a document).

### Configure — `upload` field type

- New `case "upload"` in `configure/src/core/Maker.js` renders the `UploadField` component (`configure/src/core/components/UploadField.js`), passing the active mission (`configuration.msv.missionFolderName || configuration.msv.mission`), the computed API domain, and `subdir={com.subdir}` — the upload target folder declared by the field's own config.
- `UploadField` takes a `subdir` prop, shows a file `<input accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml">` and, on select, guards that a `mission` and a `subdir` are present (errors via `onError` if either is missing) before calling `uploadImage(file, mission, subdir)` from `configure/src/core/upload.js`.
- `uploadImage(file, mission, subdir)` POSTs the file (field name `image`) to `${domain}api/upload?mission=<name>&subdir=<subdir>` with `credentials: 'include'`, and resolves with the returned mission-relative `path` (or throws with the server's error message). It contains no hardcoded plugin name — the `subdir` is purely a parameter.
- The card declares its own `subdir` in `src/essence/Tools/Card/config.json`: the `image` sub-field is `type: "upload"` with `"subdir": "CardPlugin"`. So `"CardPlugin"` lives **only** in the plugin's config — the Configure core (`Maker.js`, `UploadField`, `upload.js`) holds no card-specific knowledge, making the `upload` field type genuinely reusable by any plugin (each declares its own `subdir`).
- On success the field calls `updateConfiguration(forceField || com.field, path, layer)`; on failure it surfaces the error via the snackbar (`onError`). Functions inside `objectarray`, so each card row gets its own uploader. Reuses the existing config-value plumbing — no change to how values save/load.

### Frontend — `src/essence/Tools/Card/`

Mirrors `LayerManager`:

- `CardTool.tsx` — lifecycle object (`initialize`, `make(targetId)`, `destroy`, `getUrlString`), `createRoot` mount/unmount, `made`/`targetId` state, cleanups. `initialize` requests `app:isMobile` to switch to a full-width panel on mobile.
- `MMGISCardAdapter.tsx` — uses `useMMGISHandlerReady('tool:getVars', refresh)` to defer the first fetch until the handler is registered, then calls `getCardData()` and renders the presentational `CardList`. Bus-agnostic components downstream.
- `adapters/getCardData.ts` — orchestrator: reads `cards` via `mmgisRequest('tool:getVars', 'card')` and the mission path via `mmgisRequest('app:getMissionPath')`, then delegates to `buildCardData`.
- `adapters/buildCardData.ts` — pure transform from raw config cards + mission path to renderable `CardItem[]`. Contains `resolveImageUrl` (mission-relative → absolute, render-time) and `resolveLinkUrl` (render-time link normalization/sanitization).
- `lib/components/Card/Card.tsx`, `lib/components/CardList/CardList.tsx` — pure presentational; `lib/index.ts` re-exports them and the `CardItem` type and side-effect-imports the styles. `lib/types.ts` defines `CardItem`.
- `lib/styles/` — `index.scss` → `components/index.scss` → `components/card.scss`, `components/card-list.scss`.
- Shared bus adapters live at `src/essence/Tools/_shared/adapters/` (`mmgisAPI.ts`, `useMMGISHandlerReady.ts`), hoisted there so both Card and LayerManager use the same wrappers.
- `config.json` — `name: "Card"`, `paths`, `metadata` (`modernLayoutSupport: true`, `requiredOrientation: "vertical"`, `compatiblePositions: ["left","right"]`, `preferredPosition: "left"`, width 368), and the `config.rows` schema (the `cards` `objectarray`).
- Styling from the Figma CSS: Public Sans; light card background / subtle border / padding + gap; square `object-fit: cover` image (the automatic crop); title, subtitle/label, and link-label colors per the Figma.

#### Link resolution — `resolveLinkUrl`

The card render path normalizes and sanitizes each stored `linkUrl` (the image counterpart `resolveImageUrl` already existed; link handling is new):

- Root-relative internal links (e.g. `/view`, `//cdn/x`) pass through untouched.
- A scheme-less domain like `www.google.com` is coerced to `https://www.google.com` (otherwise the browser would treat it as relative to the current page). A coerced value must have a **dotted host**, so a bare single-label word like `arst` is rejected.
- Explicitly-schemed values are parsed with the built-in `URL` and accepted **only** if they resolve to `http:`/`https:`. Unsafe/non-navigable schemes (`javascript:`, `data:`, `mailto:`, `tel:`, `ftp:`, …) and a bare `host:port` (which parses as a scheme) are rejected by returning `undefined`.
- Empty/whitespace → `undefined`.

When `resolveLinkUrl` returns `undefined`, the card renders without an `href`.

## Error handling

- **Upload route:** reject non-image / oversize / bad-mission / bad-subdir / missing-file with JSON 4xx; write/mkdir errors → 500. Non-admin sessions are blocked by `ensureAdmin`.
- **Upload field:** error surfaced via the snackbar on failure; prior value retained.
- **Card tool:** waits for `tool:getVars` before fetching (avoids mounting to an empty list); `getCardData` failure logs and renders empty; a card with no title and no image renders nothing; a missing image renders an empty image placeholder rather than crashing.

## Security

- Auth: admin-gated via `s.ensureAdmin()` (admin/lead session, permission `"111"`/`"110"`; does not auto-pass under `AUTH=off`) — matching the Config write routes.
- Filename: server-generated `<uuid>.<ext>` — never trust the client filename.
- `mission` and `subdir` params validated as single safe path segments; no `..` traversal, separators, or pure-dot names.
- MIME → extension allow-list (png/jpeg/webp/gif/svg). SVG is permitted because cards render via `<img src>` and uploaders are trusted admins; residual risk is limited to directly opening the raw asset URL.
- Size cap (5 MB) enforced server-side; partial files are cleaned up on overflow/error.

## Testing

Tests are **Playwright** (repo suite), under `tests/unit/Card/`:

- `uploadValidate.spec.js` — pure validation helpers (mime→ext mapping, safe path segments).
- `uploadRouting.spec.js` — upload route behavior (valid save + returned path; bad mission/subdir; unsupported type; oversize; missing file).
- `uploadImage.spec.js` — the Configure-side upload caller (`uploadImage(file, mission, subdir)` from `configure/src/core/upload.js`).
- `resolveImageUrl.spec.js` — render-time image URL resolution.
- **Manual:** configure a mission with 2–3 cards incl. real uploads; confirm the sidebar matches the Figma.

## Out of scope (future work)

- S3 upload backend (issue notes this as future; the generic upload route is the seam where the storage backend would swap).
- Server-side crop/resize (current approach is CSS `object-fit: cover`).
- Drag-reorder beyond what the `objectarray` UI already provides.
