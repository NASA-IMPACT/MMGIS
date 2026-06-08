# Card Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Card plugin — a modern TSX/React sidebar tool that renders a configurable list of cards (square-cropped image, title, subtitle, link), authored in the Configure page via a new image-upload field, with images stored under `Missions/<mission>/CardPlugin/uploads/`.

**Architecture:** Three independent units. (1) A **generic, plugin-agnostic** core upload service `API/Backend/Upload/` with one `busboy` upload route writing to the per-mission `Missions/` dir (served statically already). The card plugin has NO backend folder — it just calls this generic endpoint with `subdir=CardPlugin`. (2) A new reusable `upload` field type in the Configure SPA (`Maker.js`) that POSTs a file and stores the returned mission-relative path. (3) A modern Card tool (`src/essence/Tools/Card/`) mirroring `LayerManager` — `createRoot`, `targetId`, event-bus only — that reads its `cards` tool-var and renders them. Card *data* lives in mission config (existing save/load); the only new backend surface is the generic upload service.

**Tech Stack:** Node/Express + `busboy` 1.6 (backend), React 19 + TypeScript + SCSS (tool), MUI + Redux (Configure SPA), Playwright unit specs (`tests/unit/Card/`).

**Spec:** `docs/superpowers/specs/2026-05-28-card-plugin-design.md`

**Conventions verified during planning:**
- Backend module discovery: `API/setups.js` auto-loads `API/Backend/*/setup.js`; `onceInit(s)` registers routes via `s.app.use(s.ROOT_PATH + "/api/...", ...middleware, router)`. The upload service follows the **admin-gated** posture of the Config write routes (`API/Backend/Config/setup.js`): `s.app.use(s.ROOT_PATH + "/api/upload", s.ensureAdmin(), s.checkHeadersCodeInjection, s.setContentType, router)`. `s.ensureAdmin()` requires an authenticated admin/lead session (permission "111"/"110") and does NOT auto-pass under `AUTH=off`.
- `logger = require("../../logger")` from `API/Backend/Upload/uploadRouter.js`; signature `logger(level, message, caller, req, err)`.
- Repo root from `API/Backend/Upload/uploadRouter.js`: `path.join(__dirname, "../../../")` → `Missions/` at repo root, served statically (`scripts/server.js`).
- `busboy` 1.6 API: `const busboy = require("busboy"); const bb = busboy({ headers, limits }); bb.on("file", (name, stream, info) => { info.mimeType })`. (Do NOT copy the stale 5-arg signature in `datasets.js`.)
- Tool discovery: `API/updateTools.js` globs `src/essence/Tools/*` for a `config.json`; no central registration. `config.json.paths` point to module path without extension (e.g. `essence/Tools/Card/CardTool`).
- Event-bus handlers already registered by `Layers_.fina()`: `tool:getVars` (→ `L_.getToolVars(toolName)`, key is the lowercased tool name, e.g. `"card"`) and `app:getMissionPath` (→ `L_.missionPath`, a string like `"Missions/<mission>/"` with trailing slash). See `src/essence/Basics/Layers_/Layers_.js:220-222`.
- Shared bus adapters: `mmgisAPI.ts` (the `mmgisRequest`/`mmgisOn`/`mmgisEmit`/`mmgisProvide`/`mmgisHasHandler` wrappers + `Window.mmgisAPI` type) and `useMMGISHandlerReady.ts` (a hook that polls `mmgisAPI.hasHandler(name)` until a bus capability registers, then fires once) live at `src/essence/Tools/_shared/adapters/`, shared with LayerManager.
- Configure SPA: in `Maker.js` render scope, the active mission is `configuration?.msv?.missionFolderName || configuration?.msv?.mission`; persist via `updateConfiguration(field, value, layer)`; show errors via `dispatch(setSnackBarText({ text, severity }))`. Request base `domain` is computed as in `configure/src/core/calls.js` (dev → `http://localhost:8888/`, else `window.mmgisglobal.ROOT_PATH`).
- Playwright unit spec pattern (`tests/unit/LayerManager/handlers.spec.js`): `import { test, expect } from '@playwright/test'`, import TS source directly, mock globals (`global.window.mmgisAPI`, `global.fetch`). Run a single file with `npx playwright test <path>`.

---

### Task 1: Generic core image-upload service

**Goal:** A generic, plugin-agnostic `POST /api/upload?mission=<name>&subdir=<name>` route that validates and saves an image to `Missions/<mission>/<subdir>/uploads/<uuid>.<ext>` and returns the mission-relative path, plus a pure validation module unit-tested via Playwright. The card plugin reuses this with `subdir=CardPlugin`; no card-specific backend code exists.

**Files:**
- Create: `API/Backend/Upload/validate.js`
- Test: `tests/unit/Card/uploadValidate.spec.js`
- Create: `API/Backend/Upload/uploadRouter.js`
- Create: `API/Backend/Upload/setup.js`
- Test: `tests/unit/Card/uploadRouting.spec.js` (route-mounting regression: `POST /api/upload` resolves at the mount point — 400 not 404 — and `/api/upload/upload` 404s)

**Acceptance Criteria:**
- [ ] `extensionForMime` maps allowed image MIME types (png/jpeg/webp/gif/svg) to extensions and returns `null` otherwise.
- [ ] `isValidMission`/`isValidSubdir` (both aliases of `isSafePathSegment`) reject empty, non-string, `..`, pure-dot (`.`), and path-separator values; accept plain names.
- [ ] Validation spec passes under Playwright.
- [ ] Route registered behind `s.ensureAdmin()`; `createUploadRouter(options)` saves allowed images, returns `{ status: "success", path }`; rejects bad mission (400), bad subdir (400), unsupported type (400), oversize (413), missing file (400).
- [ ] Module is auto-discovered by `API/setups.js` (no other wiring).

**Verify:** `npx playwright test tests/unit/Card/uploadValidate.spec.js` → all tests pass.

**Steps:**

- [ ] **Step 1: Write the failing validation test**

Create `tests/unit/Card/uploadValidate.spec.js`:

```js
import { test, expect } from '@playwright/test'
import {
    extensionForMime,
    isValidMission,
    isValidSubdir,
} from '../../../API/Backend/Upload/validate.js'

test.describe('Upload validation', () => {
    test('extensionForMime maps allowed image types', () => {
        expect(extensionForMime('image/png')).toBe('png')
        expect(extensionForMime('image/jpeg')).toBe('jpg')
        expect(extensionForMime('image/webp')).toBe('webp')
        expect(extensionForMime('image/gif')).toBe('gif')
        expect(extensionForMime('image/svg+xml')).toBe('svg')
    })

    test('extensionForMime rejects disallowed types', () => {
        expect(extensionForMime('application/pdf')).toBeNull()
        expect(extensionForMime(undefined)).toBeNull()
    })

    test('isValidMission accepts plain names', () => {
        expect(isValidMission('MSL')).toBe(true)
        expect(isValidMission('My_Mission-1')).toBe(true)
    })

    test('isValidMission rejects traversal and separators', () => {
        expect(isValidMission('')).toBe(false)
        expect(isValidMission('.')).toBe(false)
        expect(isValidMission('..')).toBe(false)
        expect(isValidMission('a/../b')).toBe(false)
        expect(isValidMission('a/b')).toBe(false)
        expect(isValidMission('a\\b')).toBe(false)
        expect(isValidMission(null)).toBe(false)
        expect(isValidMission(42)).toBe(false)
    })

    test('isValidSubdir accepts plain names and rejects traversal', () => {
        expect(isValidSubdir('CardPlugin')).toBe(true)
        expect(isValidSubdir('')).toBe(false)
        expect(isValidSubdir('.')).toBe(false)
        expect(isValidSubdir('..')).toBe(false)
        expect(isValidSubdir('a/../b')).toBe(false)
        expect(isValidSubdir('a/b')).toBe(false)
        expect(isValidSubdir('a\\b')).toBe(false)
        expect(isValidSubdir(null)).toBe(false)
        expect(isValidSubdir(undefined)).toBe(false)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/unit/Card/uploadValidate.spec.js`
Expected: FAIL — cannot resolve `validate.js` (module does not exist yet).

- [ ] **Step 3: Implement the validation module**

Create `API/Backend/Upload/validate.js`:

```js
// Pure validation helpers for image upload routes (see ./uploadRouter.js).

const IMAGE_MIME_TO_EXT = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    // SVG is allowed: uploaders are trusted admins, and cards render images via
    // <img src>, which does not execute scripts embedded in an SVG. (Residual
    // risk is limited to someone opening the raw asset URL directly.)
    'image/svg+xml': 'svg',
};

// Map an upload mimetype to a safe file extension using the given allow-list,
// or null if the type is not allowed.
function extensionForMime(mimeType, allowedMimeToExt = IMAGE_MIME_TO_EXT) {
    if (typeof mimeType !== 'string') return null;
    return allowedMimeToExt[mimeType.toLowerCase()] || null;
}

// A single safe path segment: rejects anything that could escape its parent
// directory (no traversal, no separators, no pure-dot name like "." or "..").
function isSafePathSegment(value) {
    if (typeof value !== 'string') return false;
    if (value.trim() === '') return false;
    if (value.includes('..')) return false;
    if (value.includes('/') || value.includes('\\')) return false;
    // A pure-dot name (e.g. ".") resolves to a directory segment, so the upload
    // would land in the parent instead of the intended folder.
    if (/^\.+$/.test(value)) return false;
    return true;
}

// Mission name and upload subdir share the same constraint: one safe segment
// under Missions/. Named separately so callers read clearly at the call site.
const isValidMission = isSafePathSegment;
const isValidSubdir = isSafePathSegment;

module.exports = {
    IMAGE_MIME_TO_EXT,
    extensionForMime,
    isSafePathSegment,
    isValidMission,
    isValidSubdir,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/unit/Card/uploadValidate.spec.js`
Expected: PASS.

- [ ] **Step 5: Implement the upload router factory**

Create `API/Backend/Upload/uploadRouter.js`. `createUploadRouter(options)` returns an Express router with one POST handler; the caller passes `mission` and `subdir` as query params (both validated), and mount-level policy (`allowedMimeToExt`, `maxFileBytes`, `routePath`) comes from `options`:

```js
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const busboy = require('busboy');
const logger = require('../../logger');
const {
    extensionForMime,
    isValidMission,
    isValidSubdir,
    IMAGE_MIME_TO_EXT,
} = require('./validate');

const MISSIONS_DIR = path.join(__dirname, '../../../Missions');
const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

// Build a generic, plugin-agnostic single-file image-upload router. The caller
// supplies the target per request via the `mission` and `subdir` query params
// (both validated against path traversal); the file lands at
// Missions/<mission>/<subdir>/uploads/<uuid>.<ext> and the route responds with
// { status: 'success', path: '<subdir>/uploads/<uuid>.<ext>' } (mission-relative).
//
// Options (mount-level policy, not per-request):
//   allowedMimeToExt  mimetype -> extension allow-list (default: images)
//   maxFileBytes      per-file size cap (default: 5 MB)
//   routePath         router-relative path for the POST handler (default: /upload)
function createUploadRouter(options = {}) {
    const {
        allowedMimeToExt = IMAGE_MIME_TO_EXT,
        maxFileBytes = DEFAULT_MAX_FILE_BYTES,
        routePath = '/upload',
    } = options;

    const router = express.Router();

    // POST <routePath>?mission=<name>&subdir=<name>  (multipart, single file)
    router.post(routePath, function (req, res) {
        const mission = req.query.mission;
        if (!isValidMission(mission)) {
            return res
                .status(400)
                .json({ status: 'failure', message: 'Invalid or missing mission' });
        }

        const subdir = req.query.subdir;
        if (!isValidSubdir(subdir)) {
            return res
                .status(400)
                .json({ status: 'failure', message: 'Invalid or missing upload target' });
        }

        // The mission's folder may not exist yet — e.g. missions imported via
        // "Upload Config.JSON" don't materialize a Missions/<mission>/ directory
        // (only the "add mission" flow does). The mission name is already
        // validated against path traversal and this route is admin-gated, so
        // create the uploads path on demand rather than rejecting.
        const missionDir = path.join(MISSIONS_DIR, mission);

        let bb;
        try {
            bb = busboy({
                headers: req.headers,
                limits: { files: 1, fileSize: maxFileBytes },
            });
        } catch (err) {
            return res
                .status(400)
                .json({ status: 'failure', message: 'Invalid upload request' });
        }

        let responded = false;
        const fail = (code, message, err) => {
            if (err)
                logger('error', `Upload (${subdir}): ${message}`, 'Upload', req, err);
            if (responded) return;
            responded = true;
            res.status(code).json({ status: 'failure', message });
        };
        const succeed = () => {
            if (responded) return;
            responded = true;
            res.status(200).json({ status: 'success', path: savedRelPath });
        };

        let fileReceived = false;
        let savedRelPath = null;
        let destPath = null;

        bb.on('file', (name, file, info) => {
            fileReceived = true;
            const ext = extensionForMime(info && info.mimeType, allowedMimeToExt);
            if (!ext) {
                file.resume(); // drain so the request can finish
                return fail(400, 'Unsupported image type');
            }

            const uploadsDir = path.join(missionDir, subdir, 'uploads');
            try {
                fs.mkdirSync(uploadsDir, { recursive: true });
            } catch (err) {
                file.resume();
                return fail(500, 'Failed to create uploads directory', err);
            }

            const filename = `${crypto.randomUUID()}.${ext}`;
            destPath = path.join(uploadsDir, filename);
            savedRelPath = `${subdir}/uploads/${filename}`;

            const writeStream = fs.createWriteStream(destPath);
            file.pipe(writeStream);

            file.on('limit', () => {
                writeStream.destroy();
                fs.unlink(destPath, () => {});
                savedRelPath = null;
                fail(413, 'Image exceeds size limit');
            });
            writeStream.on('error', (err) => {
                fs.unlink(destPath, () => {});
                savedRelPath = null;
                fail(500, 'Failed to save image', err);
            });
            // Only report success once the bytes are flushed to disk. Responding
            // on busboy's 'close' would race the write stream — 'close' fires
            // when the file readable has been drained into the write buffer, not
            // when the file is fully written, so the client could get a path to a
            // partial or (on a late write error + unlink) already-deleted file.
            writeStream.on('finish', () => {
                if (savedRelPath) succeed();
            });
        });

        bb.on('error', (err) => fail(500, 'Upload failed', err));

        bb.on('close', () => {
            // A successful upload responds from the write stream's 'finish'. If no
            // file part ever arrived, nothing else will respond — handle that here.
            if (!fileReceived) fail(400, 'No image provided');
        });

        req.pipe(bb);
    });

    return router;
}

module.exports = { createUploadRouter };
```

- [ ] **Step 6: Implement the setup module**

Create `API/Backend/Upload/setup.js`. Mount the router at `/api/upload` behind `s.ensureAdmin()` (same posture as the Config write routes), passing `routePath: '/'` so the handler sits at the mount point (the default `/upload` would double to `/api/upload/upload`):

```js
const { createUploadRouter } = require('./uploadRouter');
const { IMAGE_MIME_TO_EXT } = require('./validate');

// Upload is a generic, plugin-agnostic core service. It exposes a single image
// upload endpoint that any caller (plugin or core) reaches over the API — no
// per-plugin backend code lives here. The caller names its target per request
// via the `mission` and `subdir` query params (both validated against path
// traversal); files land under Missions/<mission>/<subdir>/uploads/.
let setup = {
    // Once the app initializes
    onceInit: (s) => {
        // Image upload is a Configure-page (admin) action, so it uses the same
        // authorization posture as the Config write routes (see
        // API/Backend/Config/setup.js): ensureAdmin requires an authenticated
        // admin/lead session (permission "111"/"110"). It does NOT auto-pass
        // under AUTH=off — a session without an admin permission is rejected.
        s.app.use(
            s.ROOT_PATH + '/api/upload',
            s.ensureAdmin(),
            s.checkHeadersCodeInjection,
            s.setContentType,
            // routePath '/' so the handler sits at the mount point itself
            // (/api/upload). The default '/upload' would double to
            // /api/upload/upload and 404 the caller.
            createUploadRouter({
                allowedMimeToExt: IMAGE_MIME_TO_EXT,
                routePath: '/',
            })
        );
    },
    // Once the server starts
    onceStarted: (s) => {},
    // Once all tables sync
    onceSynced: (s) => {},
};

module.exports = setup;
```

- [ ] **Step 7: Manually verify route registration**

Run: `node -e "require('./API/Backend/Upload/setup.js'); console.log('setup loads OK')"`
Expected: prints `setup loads OK` with no require errors.

- [ ] **Step 8: Commit**

```bash
git add API/Backend/Upload/ tests/unit/Card/uploadValidate.spec.js tests/unit/Card/uploadRouting.spec.js
git commit -m "feat(upload): add generic core image upload service"
```

---

### Task 2: `upload` config field type in the Configure SPA

**Goal:** Add a reusable `upload` field type so admins can upload an image (instead of typing a path) anywhere in the config schema, including inside an `objectarray`. The field POSTs to the Task 1 generic upload endpoint (with `subdir=CardPlugin`) and stores the returned mission-relative path.

**Files:**
- Create: `configure/src/core/cardUpload.js`
- Test: `tests/unit/Card/uploadImage.spec.js`
- Create: `configure/src/core/components/UploadField.js`
- Modify: `configure/src/core/Maker.js` (add `case "upload"` in the component-render switch)

**Acceptance Criteria:**
- [ ] `uploadCardImage(file, mission)` POSTs `multipart/form-data` (field `image`) to `${domain}api/upload?mission=<mission>&subdir=CardPlugin` and resolves to the returned `path`; throws on non-success.
- [ ] Unit spec passes (fetch mocked).
- [ ] `Maker.js` renders a file picker + preview + clear for `type: "upload"`, persists the returned path via `updateConfiguration`, and surfaces errors via the snackbar.

**Verify:** `npx playwright test tests/unit/Card/uploadImage.spec.js` → passes.

**Steps:**

- [ ] **Step 1: Write the failing upload-helper test**

Create `tests/unit/Card/uploadImage.spec.js`:

```js
import { test, expect } from '@playwright/test'
import { uploadCardImage } from '../../../configure/src/core/cardUpload.js'

const installFetchMock = (impl) => {
    global.window = global.window || {}
    global.window.mmgisglobal = { NODE_ENV: 'production', ROOT_PATH: '' }
    global.fetch = impl
    if (!global.FormData) {
        // Minimal FormData stand-in for Node test env.
        global.FormData = class {
            constructor() { this._d = {} }
            append(k, v) { this._d[k] = v }
        }
    }
}

test.describe('uploadCardImage', () => {
    test('POSTs to the upload route and returns the path', async () => {
        let calledUrl = null
        let calledInit = null
        installFetchMock(async (url, init) => {
            calledUrl = url
            calledInit = init
            return {
                ok: true,
                json: async () => ({ status: 'success', path: 'CardPlugin/uploads/x.png' }),
            }
        })
        const path = await uploadCardImage({ name: 'x.png' }, 'MSL')
        expect(path).toBe('CardPlugin/uploads/x.png')
        expect(calledUrl).toBe('api/upload?mission=MSL&subdir=CardPlugin')
        expect(calledInit.method).toBe('POST')
    })

    test('throws on a failure response', async () => {
        installFetchMock(async () => ({
            ok: false,
            json: async () => ({ status: 'failure', message: 'Unsupported image type' }),
        }))
        await expect(uploadCardImage({ name: 'x.svg' }, 'MSL')).rejects.toThrow(
            'Unsupported image type',
        )
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/unit/Card/uploadImage.spec.js`
Expected: FAIL — `cardUpload.js` does not exist.

- [ ] **Step 3: Implement the upload helper**

Create `configure/src/core/cardUpload.js`:

```js
// Computes the API base the same way configure/src/core/calls.js does.
function getDomain() {
    let d =
        window.mmgisglobal && window.mmgisglobal.NODE_ENV === 'development'
            ? 'http://localhost:8888/'
            : (window.mmgisglobal && window.mmgisglobal.ROOT_PATH) || '';
    if (d.length > 0 && !d.endsWith('/')) d += '/';
    return d;
}

// Uploads an image File to the generic core upload endpoint for `mission`,
// under the card plugin's own `subdir`. Resolves with the stored
// mission-relative path, or throws with the server's error message.
export async function uploadCardImage(file, mission) {
    const form = new FormData();
    form.append('image', file);

    const url = `${getDomain()}api/upload?mission=${encodeURIComponent(
        mission,
    )}&subdir=CardPlugin`;
    const res = await fetch(url, {
        method: 'POST',
        body: form,
        credentials: 'include',
    });

    let data = {};
    try {
        data = await res.json();
    } catch (e) {
        data = {};
    }
    if (!res.ok || data.status !== 'success' || !data.path) {
        throw new Error(data.message || 'Image upload failed');
    }
    return data.path;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/unit/Card/uploadImage.spec.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Implement the UploadField component**

Create `configure/src/core/components/UploadField.js`:

```js
import React, { useRef, useState } from 'react';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import { uploadCardImage } from '../cardUpload';

// A config field that uploads an image and stores the returned mission-relative
// path. `value` is the current stored path (may be empty). On success it calls
// onChange(path); on failure it calls onError(message) and keeps the old value.
export default function UploadField({
    label,
    description,
    value,
    mission,
    disabled,
    domain,
    onChange,
    onError,
}) {
    const inputRef = useRef(null);
    const [uploading, setUploading] = useState(false);

    const handleSelect = async (e) => {
        const file = e.target.files && e.target.files[0];
        // Reset the input so selecting the same file again re-triggers change.
        e.target.value = '';
        if (!file) return;
        if (!mission) {
            onError && onError('Save or select a mission before uploading.');
            return;
        }
        setUploading(true);
        try {
            const path = await uploadCardImage(file, mission);
            onChange && onChange(path);
        } catch (err) {
            onError && onError(err.message || 'Image upload failed');
        } finally {
            setUploading(false);
        }
    };

    // Build a preview URL for the current value (mission-relative path).
    const previewSrc =
        value && /^(https?:|data:|\/)/i.test(value)
            ? value
            : value
              ? `${domain || ''}Missions/${mission}/${value}`
              : '';

    return (
        <div style={disabled ? { opacity: 0.5 } : {}}>
            <Typography variant="caption">{label}</Typography>
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    margin: '4px 0',
                }}
            >
                {previewSrc ? (
                    <img
                        src={previewSrc}
                        alt=""
                        style={{
                            width: 48,
                            height: 48,
                            objectFit: 'cover',
                            border: '1px solid #DFE1E2',
                            borderRadius: 2,
                        }}
                    />
                ) : null}
                <Button
                    variant="outlined"
                    size="small"
                    disabled={disabled || uploading}
                    onClick={() => inputRef.current && inputRef.current.click()}
                >
                    {uploading ? 'Uploading…' : value ? 'Replace image' : 'Upload image'}
                </Button>
                {value ? (
                    <Button
                        variant="text"
                        size="small"
                        disabled={disabled || uploading}
                        onClick={() => onChange && onChange('')}
                    >
                        Clear
                    </Button>
                ) : null}
                <input
                    ref={inputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                    style={{ display: 'none' }}
                    onChange={handleSelect}
                />
            </div>
            {description ? (
                <div
                    style={{ fontSize: 12, color: '#888' }}
                    dangerouslySetInnerHTML={{ __html: description }}
                />
            ) : null}
        </div>
    );
}
```

- [ ] **Step 6: Wire the `upload` case into Maker.js**

In `configure/src/core/Maker.js`, add the import near the other component imports at the top of the file:

```js
import UploadField from "./components/UploadField";
```

Then add a new `case` inside the component-render `switch` (the same switch that contains `case "text":` near line 428). Place it adjacent to `case "text":`:

```js
    case "upload": {
      const uploadDomain =
        window.mmgisglobal && window.mmgisglobal.NODE_ENV === "development"
          ? "http://localhost:8888/"
          : (window.mmgisglobal && window.mmgisglobal.ROOT_PATH) || "";
      const normalizedDomain =
        uploadDomain.length > 0 && !uploadDomain.endsWith("/")
          ? uploadDomain + "/"
          : uploadDomain;
      return (
        <UploadField
          label={com.name}
          description={com.description}
          value={fieldValue}
          mission={
            configuration?.msv?.missionFolderName ||
            configuration?.msv?.mission
          }
          domain={normalizedDomain}
          disabled={disabled || isDisabled}
          onChange={(p) =>
            updateConfiguration(forceField || com.field, p, layer)
          }
          onError={(msg) =>
            dispatch(setSnackBarText({ text: msg, severity: "error" }))
          }
        />
      );
    }
```

> `fieldValue`, `com`, `configuration`, `disabled`, `isDisabled`, `forceField`, `layer`, `updateConfiguration`, `dispatch`, and `setSnackBarText` are all already in scope in this function (confirmed against `case "text":` and `case "button":`). The mission segment used to build the storage path is `configuration?.msv?.missionFolderName || configuration?.msv?.mission` — the folder name is the on-disk directory under `Missions/`.

- [ ] **Step 7: Verify the Configure SPA still builds**

Run: `cd configure && npx vite build` (or the repo's configure build command — check `configure/package.json` `scripts`).
Expected: build completes without errors referencing `UploadField`/`upload`.

> If the configure build command differs, use whatever `configure/package.json` defines for `build`. The goal is only to confirm the new imports compile.

- [ ] **Step 8: Commit**

```bash
git add configure/src/core/cardUpload.js configure/src/core/components/UploadField.js configure/src/core/Maker.js tests/unit/Card/uploadImage.spec.js
git commit -m "feat(configure): add reusable image upload field type"
```

---

### Task 3: Card tool scaffold, shared adapters, and data resolution

**Goal:** Register the Card tool so it mounts in the sidebar (modern pattern: `createRoot`, `targetId`, event-bus only), reads its `cards` tool-var, and exposes unit-tested pure helpers that resolve a stored image path to a renderable URL and a stored link to a safe href. The shared bus wrappers (`mmgisAPI.ts`, `useMMGISHandlerReady.ts`) are hoisted to `_shared/adapters/` (shared with LayerManager); the card's own `adapters/` folder holds `buildCardData.ts` (pure transform) and `getCardData.ts` (bus orchestrator). The panel renders a loading/empty state at this stage (real card UI lands in Task 4).

**Files:**
- Create (or reuse): `src/essence/Tools/_shared/adapters/mmgisAPI.ts`
- Create (or reuse): `src/essence/Tools/_shared/adapters/useMMGISHandlerReady.ts`
- Create: `src/essence/Tools/Card/lib/types.ts`
- Create: `src/essence/Tools/Card/adapters/buildCardData.ts`
- Test: `tests/unit/Card/resolveImageUrl.spec.js`
- Create: `src/essence/Tools/Card/adapters/getCardData.ts`
- Create: `src/essence/Tools/Card/config.json`
- Create: `src/essence/Tools/Card/CardTool.tsx`
- Create: `src/essence/Tools/Card/MMGISCardAdapter.tsx`

**Acceptance Criteria:**
- [ ] `resolveImageUrl(image, missionPath)` returns `''` for empty input, passes through absolute/`data:`/root-relative URLs unchanged, and prefixes mission-relative paths with `missionPath`.
- [ ] `resolveLinkUrl(linkUrl)` coerces a scheme-less dotted domain to `https://`, passes through internal `/path` and absolute http(s), and returns `undefined` for unsafe/non-http(s) schemes and bare single-label words.
- [ ] `buildCardData(cards, missionPath)` maps raw config cards to renderable `CardItem`s (image resolved, link resolved); non-array input → `[]`.
- [ ] Resolver/builder spec passes.
- [ ] `config.json` declares the tool, the `cards` `objectarray` (with an `upload` image sub-field), and modern-layout `metadata`.
- [ ] `CardTool.tsx` mounts/unmounts a React root into `targetId` and cleans up on `destroy`.

**Verify:** `npx playwright test tests/unit/Card/resolveImageUrl.spec.js` → passes.

**Steps:**

- [ ] **Step 1: Write the failing resolver/builder test**

Create `tests/unit/Card/resolveImageUrl.spec.js` (imports the helpers from the card's `buildCardData.ts`):

```js
import { test, expect } from '@playwright/test'
import {
    resolveImageUrl,
    resolveLinkUrl,
    buildCardData,
} from '../../../src/essence/Tools/Card/adapters/buildCardData.ts'

test.describe('resolveImageUrl', () => {
    test('returns empty string for empty input', () => {
        expect(resolveImageUrl('', 'Missions/MSL/')).toBe('')
        expect(resolveImageUrl(undefined, 'Missions/MSL/')).toBe('')
    })

    test('passes through absolute and data URLs', () => {
        expect(resolveImageUrl('https://x/y.png', 'Missions/MSL/')).toBe(
            'https://x/y.png',
        )
        expect(resolveImageUrl('http://x/y.png', 'Missions/MSL/')).toBe(
            'http://x/y.png',
        )
        expect(
            resolveImageUrl('data:image/png;base64,AAAA', 'Missions/MSL/'),
        ).toBe('data:image/png;base64,AAAA')
        expect(resolveImageUrl('/already/rooted.png', 'Missions/MSL/')).toBe(
            '/already/rooted.png',
        )
    })

    test('prefixes mission-relative paths with the mission path', () => {
        expect(
            resolveImageUrl('CardPlugin/uploads/a.png', 'Missions/MSL/'),
        ).toBe('Missions/MSL/CardPlugin/uploads/a.png')
    })

    test('tolerates a null mission path', () => {
        expect(resolveImageUrl('CardPlugin/uploads/a.png', null)).toBe(
            'CardPlugin/uploads/a.png',
        )
    })
})

test.describe('buildCardData', () => {
    test('returns empty array for missing/invalid input', () => {
        expect(buildCardData(undefined, 'Missions/MSL/')).toEqual([])
        // @ts-expect-error exercising defensive non-array input
        expect(buildCardData(null, 'Missions/MSL/')).toEqual([])
    })

    test('maps raw cards to renderable items with resolved image URLs', () => {
        const out = buildCardData(
            [
                {
                    image: 'CardPlugin/uploads/a.png',
                    title: 'T',
                    subtitle: 'S',
                    linkUrl: 'https://x',
                },
            ],
            'Missions/MSL/',
        )
        expect(out).toEqual([
            {
                imageUrl: 'Missions/MSL/CardPlugin/uploads/a.png',
                title: 'T',
                subtitle: 'S',
                linkUrl: 'https://x',
            },
        ])
    })
})

test.describe('resolveLinkUrl', () => {
    test('returns undefined for empty/blank input', () => {
        expect(resolveLinkUrl('')).toBeUndefined()
        expect(resolveLinkUrl('   ')).toBeUndefined()
        expect(resolveLinkUrl(undefined)).toBeUndefined()
        expect(resolveLinkUrl(null)).toBeUndefined()
    })

    test('prepends https:// to scheme-less external links', () => {
        expect(resolveLinkUrl('www.google.com')).toBe('https://www.google.com')
        expect(resolveLinkUrl('bass.codebycarson.com')).toBe(
            'https://bass.codebycarson.com',
        )
        expect(resolveLinkUrl('  example.com/path  ')).toBe(
            'https://example.com/path',
        )
    })

    test('passes through absolute http(s) and internal links', () => {
        expect(resolveLinkUrl('https://x.com')).toBe('https://x.com')
        expect(resolveLinkUrl('http://x.com')).toBe('http://x.com')
        expect(resolveLinkUrl('/internal/path')).toBe('/internal/path')
        expect(resolveLinkUrl('//cdn.x.com/a')).toBe('//cdn.x.com/a')
    })

    test('rejects unsafe or non-http(s) schemes', () => {
        expect(resolveLinkUrl('javascript:alert(1)')).toBeUndefined()
        expect(resolveLinkUrl('data:text/html,<script>')).toBeUndefined()
        expect(resolveLinkUrl('mailto:a@b.com')).toBeUndefined()
        expect(resolveLinkUrl('tel:+15551234')).toBeUndefined()
        expect(resolveLinkUrl('ftp://x.com')).toBeUndefined()
    })

    test('rejects scheme-less bare words with no dotted host', () => {
        expect(resolveLinkUrl('arst')).toBeUndefined()
        expect(resolveLinkUrl('notaurl')).toBeUndefined()
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/unit/Card/resolveImageUrl.spec.js`
Expected: FAIL — `buildCardData.ts` does not exist.

- [ ] **Step 3: Create the lib types module**

Create `src/essence/Tools/Card/lib/types.ts` (the renderable card shape — image already resolved):

```ts
// A single card ready to render (image already resolved to a URL).
export type CardItem = {
    imageUrl: string
    title?: string
    subtitle?: string
    linkUrl?: string
}
```

- [ ] **Step 4: Implement the pure transform (image + link resolution)**

Create `src/essence/Tools/Card/adapters/buildCardData.ts`. This holds the raw config card type, the two pure resolvers, and the `buildCardData` transform:

```ts
import type { CardItem } from '../lib/types'

// Raw card shape as stored in the tool's config variables.
export type RawCard = {
    image?: string
    title?: string
    subtitle?: string
    linkUrl?: string
}

// Resolves a stored card image value to a renderable URL.
// Mission-relative paths (e.g. "CardPlugin/uploads/a.png") are prefixed with
// the mission path (e.g. "Missions/MSL/"); absolute/data/root-relative URLs
// pass through unchanged.
export function resolveImageUrl(
    image: string | undefined | null,
    missionPath: string | null,
): string {
    if (!image) return ''
    if (/^(https?:|data:|\/)/i.test(image)) return image
    return (missionPath || '') + image
}

// Resolves a stored card link to an href that points where the author meant.
// A link is either internal to the app or an absolute external http(s) link:
//   - root-relative internal links ("/view", "//cdn/x") pass through untouched;
//   - a scheme-less domain like "www.google.com" is coerced to "https://..."
//     (otherwise the browser treats it as relative to the current page); it
//     must have a dotted host, so a bare word like "arst" is rejected;
//   - anything else is validated with the built-in URL parser and accepted only
//     if it resolves to http(s) — rejecting unsafe/non-navigable schemes
//     (javascript:, data:, mailto:, tel:, ftp:, ...) by returning undefined.
// A bare "host:port" with no scheme reads as a scheme and is rejected; authors
// should write the full http(s):// URL in that case. Empty -> undefined.
export function resolveLinkUrl(
    linkUrl: string | undefined | null,
): string | undefined {
    if (!linkUrl) return undefined
    const raw = linkUrl.trim()
    if (!raw) return undefined
    if (raw.startsWith('/')) return raw

    const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw)
    const candidate = hasScheme ? raw : `https://${raw}`
    try {
        const url = new URL(candidate)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
        // A scheme-less value we coerced to https must have a dotted host, so a
        // bare word like "arst" isn't accepted as a single-label hostname.
        // Explicitly-schemed URLs are trusted as written (e.g. http://localhost).
        if (!hasScheme && !url.hostname.includes('.')) return undefined
        return candidate
    } catch {
        // not a parseable URL
    }
    return undefined
}

// Pure transform: raw config cards + mission path -> renderable lib props.
export function buildCardData(
    cards: RawCard[] | undefined,
    missionPath: string | null,
): CardItem[] {
    if (!Array.isArray(cards)) return []
    return cards.map((card) => ({
        imageUrl: resolveImageUrl(card.image, missionPath),
        title: card.title,
        subtitle: card.subtitle,
        linkUrl: resolveLinkUrl(card.linkUrl),
    }))
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx playwright test tests/unit/Card/resolveImageUrl.spec.js`
Expected: PASS.

- [ ] **Step 6: Ensure the shared bus adapters exist under `_shared/adapters/`**

The Card tool reuses the shared bus wrappers, hoisted out of LayerManager to `src/essence/Tools/_shared/adapters/`:

- `mmgisAPI.ts` — the `mmgisRequest`/`mmgisOn`/`mmgisEmit`/`mmgisProvide`/`mmgisHasHandler` wrappers and the `Window.mmgisAPI` type. Generic and tool-agnostic.
- `useMMGISHandlerReady.ts` — a hook that polls `mmgisAPI.hasHandler(name)` (default 200ms interval, 10s timeout) until a bus capability registers, then invokes its callback once. Used to wait for `tool:getVars` (registered by `Layers_.fina()` during mission load) before the first fetch.

If these already exist (they ship shared with LayerManager), reuse them as-is; otherwise create them here. There is no `useMMGISToolVars` hook in the shipped card — data is pulled imperatively in `getCardData.ts` (next step).

- [ ] **Step 7: Implement the bus orchestrator**

Create `src/essence/Tools/Card/adapters/getCardData.ts` — pulls the configured cards (tool vars, key `"card"`) and the mission path from the bus, then runs the pure transform:

```ts
import { mmgisRequest } from '../../_shared/adapters/mmgisAPI'
import { buildCardData, type RawCard } from './buildCardData'
import type { CardItem } from '../lib/types'

type CardToolVars = { cards?: RawCard[] }

// Orchestrator: pulls the configured cards (tool vars) and the mission path
// from the MMGIS event bus, then transforms them into renderable lib props.
export async function getCardData(): Promise<CardItem[]> {
    const vars =
        (await mmgisRequest<CardToolVars>('tool:getVars', 'card')) || {}
    const missionPath = await mmgisRequest<string>('app:getMissionPath')
    return buildCardData(vars.cards, typeof missionPath === 'string' ? missionPath : null)
}
```

- [ ] **Step 8: Create the tool config**

Create `src/essence/Tools/Card/config.json`:

```json
{
    "defaultIcon": "card-text-outline",
    "description": "Displays a configurable list of cards (image, title, subtitle, link) in a sidebar.",
    "descriptionFull": {
        "title": "Renders a list of cards in a sidebar panel. Each card shows a square-cropped image, a title, a subtitle, and links to a URL. Images are uploaded per-mission to Missions/<mission>/CardPlugin/uploads/.",
        "example": {
            "cards": [
                {
                    "image": "CardPlugin/uploads/example.png",
                    "title": "Seeing Beyond the Flames",
                    "subtitle": "Mapping Wildfire Impacts in Southern California",
                    "linkUrl": "https://example.com/story"
                }
            ]
        }
    },
    "hasVars": true,
    "name": "Card",
    "toolbarPriority": 3,
    "width": 368,
    "height": 0,
    "paths": {
        "CardTool": "essence/Tools/Card/CardTool"
    },
    "expandable": true,
    "metadata": {
        "icon": "card-text-outline",
        "requiredOrientation": "vertical",
        "compatiblePositions": ["left", "right"],
        "preferredPosition": "left",
        "modernLayoutSupport": true,
        "width": 368,
        "height": 0
    },
    "config": {
        "rows": [
            {
                "components": [
                    {
                        "field": "variables.cards",
                        "name": "Cards",
                        "description": "The list of cards to display in the sidebar.",
                        "type": "objectarray",
                        "width": 12,
                        "object": [
                            {
                                "field": "image",
                                "name": "Image",
                                "description": "Upload an image (png/jpg/webp/gif/svg, &le;5MB). It is cropped to a square in the card.",
                                "type": "upload",
                                "width": 12
                            },
                            {
                                "field": "title",
                                "name": "Title",
                                "description": "Card title.",
                                "type": "text",
                                "width": 12
                            },
                            {
                                "field": "subtitle",
                                "name": "Subtitle",
                                "description": "Card subtitle.",
                                "type": "text",
                                "width": 12
                            },
                            {
                                "field": "linkUrl",
                                "name": "Link URL",
                                "description": "Link opened when the card is clicked. Use a full https:// URL for external sites, or start with / for a page in this site.",
                                "type": "text",
                                "width": 12
                            }
                        ]
                    }
                ]
            }
        ]
    }
}
```

> The `defaultIcon`/`metadata.icon` value `card-text-outline` is a Material Design Icon name; adjust if the mission prefers a different icon.

- [ ] **Step 8: Create the tool lifecycle module**

Create `src/essence/Tools/Card/CardTool.tsx` (mirrors `LayerManagerTool.tsx`):

```tsx
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MMGISCardAdapter } from './MMGISCardAdapter'
import { mmgisRequest } from '../_shared/adapters/mmgisAPI'

type ToolVars = { width?: number }

let _root: Root | null = null

const CardTool = {
    height: 0,
    width: 368 as number | 'full',
    vars: {} as ToolVars,
    targetId: null as string | null,
    made: false,

    initialize: async function () {
        try {
            const isMobile = await mmgisRequest<boolean>('app:isMobile')
            if (isMobile) {
                this.width = 'full'
                this.height = 500
            }
        } catch (err) {
            console.warn(
                '[CardTool] app:isMobile unavailable:',
                err instanceof Error ? err.message : err,
            )
        }
    },

    make: function (targetId?: string) {
        this.targetId = typeof targetId === 'string' ? targetId : 'toolPanel'
        const container = document.getElementById(this.targetId)
        if (!container) {
            console.error(`CardTool: container ${this.targetId} not found`)
            return
        }
        // Don't force the classic dark panel background (var(--color-k) = #1d1f20).
        // In a themed modern panel that dark color shows through the card-list
        // padding/gaps as a dark frame around the light cards. Let the panel's
        // themed background show instead.
        _root = createRoot(container)
        _root.render(<MMGISCardAdapter />)
        this.made = true
    },

    destroy: function () {
        if (_root) {
            _root.unmount()
            _root = null
        }
        this.targetId = null
        this.made = false
    },

    getUrlString: function () {
        return ''
    },
}

export default CardTool
```

- [ ] **Step 9: Create the adapter (data fetch wired; presentational list lands in Task 4)**

Create `src/essence/Tools/Card/MMGISCardAdapter.tsx`. It waits for the `tool:getVars` bus handler (registered by `Layers_.fina()` during mission load) via `useMMGISHandlerReady`, then fetches via `getCardData()`. At this stage the `CardList` import resolves once Task 4 creates `lib/`; the data-fetch wiring is final:

```tsx
import React from 'react'
import { useState, useCallback } from 'react'
import { CardList } from './lib'
import type { CardItem } from './lib/types'
import { useMMGISHandlerReady } from '../_shared/adapters/useMMGISHandlerReady'
import { getCardData } from './adapters/getCardData'

export function MMGISCardAdapter() {
    const [cards, setCards] = useState<CardItem[]>([])
    const [loading, setLoading] = useState(true)

    const refresh = useCallback(async () => {
        try {
            setCards(await getCardData())
        } catch (err) {
            console.error('Card: refresh failed', err)
            setCards([])
        } finally {
            setLoading(false)
        }
    }, [])

    // 'tool:getVars' is registered by Layers_.fina() during mission load. Wait
    // for it before the initial fetch, otherwise the adapter mounts to an empty
    // list and never recovers (no event fires when vars first become available).
    useMMGISHandlerReady('tool:getVars', refresh)

    return <CardList cards={cards} loading={loading} />
}
```

> The `./lib` barrel and `CardList` component land in Task 4; until then this import won't resolve. If you prefer a buildable intermediate, temporarily render `null` and swap in `CardList` in Task 4 — the as-built adapter above is the final form.

- [ ] **Step 10: Verify the tool typechecks and is discovered**

Run: `npx tsc --noEmit -p tsconfig.json` (expect no new errors from `src/essence/Tools/Card/`).
Run: `node API/updateTools.js && grep -c "Card" src/pre/tools.js`
Expected: `updateTools.js` runs without error and `src/pre/tools.js` now references the Card tool (count ≥ 1).

> If `tsc --noEmit` surfaces pre-existing repo errors unrelated to Card, confirm only that no error paths include `Tools/Card/`. (The repo suppresses TS checks on legacy files — see commit `d69fe8cf`.)

- [ ] **Step 11: Commit**

```bash
git add src/essence/Tools/Card/ src/essence/Tools/_shared/adapters/ tests/unit/Card/resolveImageUrl.spec.js
git commit -m "feat(card): scaffold modern Card tool, shared adapters, and data resolvers"
```

---

### Task 4: Card presentational components and styling

**Goal:** Render the cards per the Figma — square `object-fit: cover` image, title, subtitle, whole card linking out. The adapter's data-fetch and image/link resolution already landed in Task 3; this task supplies the `lib/` presentational components (under `lib/components/`), the `lib/styles/` SCSS (theme-token-driven, `blocks-card*` class names), and the `lib/index.ts` barrel the adapter imports.

**Files:**
- Create: `src/essence/Tools/Card/lib/components/Card/Card.tsx`
- Create: `src/essence/Tools/Card/lib/components/CardList/CardList.tsx`
- Create: `src/essence/Tools/Card/lib/styles/components/card.scss`
- Create: `src/essence/Tools/Card/lib/styles/components/card-list.scss`
- Create: `src/essence/Tools/Card/lib/styles/components/index.scss`
- Create: `src/essence/Tools/Card/lib/styles/index.scss`
- Create: `src/essence/Tools/Card/lib/styles/scss-imports.d.ts` (ambient `declare module '*.scss'` so the side-effect style imports typecheck)
- Create: `src/essence/Tools/Card/lib/index.ts`

**Acceptance Criteria:**
- [ ] `Card` renders an `<a class="blocks-card">` wrapping a 65×65 `object-fit: cover` `.blocks-card__image`, the title, and the subtitle; uses `target="_blank"` + `rel="noopener noreferrer"`; renders nothing when both title and image are empty.
- [ ] `CardList` maps cards to `Card`s inside `.blocks-card-list`; suppresses output while `loading`.
- [ ] Styling uses `--theme-*` custom properties (with Figma values as fallbacks) — colors/typography/spacing.
- [ ] `lib/index.ts` re-exports `Card`/`CardList`/`CardItem` and side-effect-imports the compiled styles.

**Verify:** `npx tsc --noEmit -p tsconfig.json` (no new `Tools/Card/` errors) + manual check (Step 7).

**Steps:**

- [ ] **Step 1: Create the card styles**

Create `src/essence/Tools/Card/lib/styles/components/card.scss` (nested BEM with `--theme-*` tokens; Figma values are fallbacks):

```scss
.blocks-card {
    box-sizing: border-box;
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    gap: var(--theme-spacing-105, 0.75rem);
    padding: var(--theme-spacing-2, 1rem);
    background: var(--theme-color-base-lightest, #f2f5f7);
    border: 1px solid var(--theme-color-base-lighter, #dfe1e2);
    text-decoration: none;
    width: 100%;
    font-family: var(--theme-font-sans, 'Public Sans', sans-serif);

    &__image {
        flex: none;
        width: 65px;
        height: 65px;
        object-fit: cover;
        background: var(--theme-color-base-lighter, #dfe1e2);
    }

    &__body {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
    }

    &__title {
        font-size: var(--theme-font-size-sm, 0.875rem);
        font-weight: var(--theme-font-weight-normal, 400);
        line-height: 160%;
        color: var(--theme-color-ink, #0d313d);
    }

    &__subtitle {
        font-size: var(--theme-font-size-2xs, 0.75rem);
        font-weight: var(--theme-font-weight-normal, 400);
        line-height: 160%;
        color: var(--theme-color-base-dark, #565c65);
    }
}
```

- [ ] **Step 2: Create the card-list styles**

Create `src/essence/Tools/Card/lib/styles/components/card-list.scss`:

```scss
.blocks-card-list {
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: var(--theme-spacing-105, 0.75rem);
    padding: var(--theme-spacing-105, 0.75rem);
    width: 100%;
}
```

- [ ] **Step 3: Create the style barrels**

Create `src/essence/Tools/Card/lib/styles/components/index.scss`:

```scss
@use 'card';
@use 'card-list';
```

Create `src/essence/Tools/Card/lib/styles/index.scss`:

```scss
// Theming (USWDS framework + theme tokens + :root --theme-* custom properties)
// is provided by MMGIS's per-theme bundles at dist/<theme>.css, loaded at
// runtime. Component partials reference --theme-* directly.
@forward 'components';
```

- [ ] **Step 4: Create the Card component**

Create `src/essence/Tools/Card/lib/components/Card/Card.tsx`. `CardProps` is just `CardItem` (from `lib/types.ts`); styles are imported once via the barrel, not per-component:

```tsx
import React from 'react'
import type { CardItem } from '../../types'

export type CardProps = CardItem

export function Card({ imageUrl, title, subtitle, linkUrl }: CardProps) {
    if (!title && !imageUrl) return null
    return (
        <a
            className="blocks-card"
            href={linkUrl || undefined}
            target="_blank"
            rel="noopener noreferrer"
        >
            {imageUrl ? (
                <img className="blocks-card__image" src={imageUrl} alt={title || ''} />
            ) : (
                <div className="blocks-card__image" />
            )}
            <div className="blocks-card__body">
                {title ? <div className="blocks-card__title">{title}</div> : null}
                {subtitle ? (
                    <div className="blocks-card__subtitle">{subtitle}</div>
                ) : null}
            </div>
        </a>
    )
}
```

- [ ] **Step 5: Create the CardList component**

Create `src/essence/Tools/Card/lib/components/CardList/CardList.tsx` (takes a `loading` flag that suppresses output until the first data load resolves):

```tsx
import React from 'react'
import { Card } from '../Card/Card'
import type { CardItem } from '../../types'

export type CardListProps = {
    /** Cards to render (image already resolved to a URL). */
    cards: CardItem[]
    /** Suppresses rendering until the first data load resolves. */
    loading?: boolean
}

export function CardList({ cards, loading }: CardListProps) {
    if (loading) return null
    return (
        <div className="blocks-card-list">
            {cards.map((card, i) => (
                <Card
                    key={i}
                    imageUrl={card.imageUrl}
                    title={card.title}
                    subtitle={card.subtitle}
                    linkUrl={card.linkUrl}
                />
            ))}
        </div>
    )
}
```

- [ ] **Step 6: Create the lib barrel**

Create `src/essence/Tools/Card/lib/index.ts`. It re-exports the components and the shared `CardItem` type, and side-effect-imports the compiled styles:

```ts
// Components
export { Card, type CardProps } from './components/Card/Card'
export { CardList, type CardListProps } from './components/CardList/CardList'

// Shared domain types
export type { CardItem } from './types'

// Side-effect import of compiled styles
import './styles/index.scss'
```

> The adapter (`MMGISCardAdapter.tsx`) was already written in Task 3 to import `CardList`/`CardItem` from this barrel and render `<CardList cards={cards} loading={loading} />`; no further adapter changes are needed here.

- [ ] **Step 7: Verify typecheck and manual rendering**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors from `src/essence/Tools/Card/`.

Manual check (hot-reload dev server is typically already running per AGENTS.md):
1. In the Configure page, add the **Card** tool to a mission's toolbar; add 2 cards, uploading a real image for each and filling title/subtitle/link; save.
2. Open the mission in the map app; open the Card tool from the sidebar.
3. Confirm each card shows a square-cropped image, title, subtitle, and that clicking opens the link in a new tab. Confirm an uploaded image is reachable at `/Missions/<mission>/CardPlugin/uploads/<uuid>.<ext>`.

- [ ] **Step 7: Commit**

```bash
git add src/essence/Tools/Card/
git commit -m "feat(card): render cards with square images, title, subtitle, link"
```

---

## Self-Review

**Spec coverage:**
- Card plugin in sidebar → Tasks 3–4 (modern tool, `metadata` left/right vertical). ✓
- Admin config: image upload, title, subtitle, link → Task 3 `config.json` `objectarray` + Task 2 `upload` field. ✓
- Image upload to `uploads/` folder on disk (per-mission) → Task 1's generic upload service writes `Missions/<mission>/<subdir>/uploads/`; the card uses `subdir=CardPlugin`. ✓ (Reconciled the spec's "within the plugin folder" with the reality that the bundled tool dir is not writable/served, and made the backend plugin-agnostic so other plugins can reuse it.)
- Future S3 → documented out-of-scope; the generic upload service is the swap seam. ✓
- Cropped to square automatically → CSS `object-fit: cover` in `card.scss` (`.blocks-card__image`). ✓
- List of cards → `objectarray` + `CardList` (`.blocks-card-list`). ✓
- Reference slesaad's modern pattern → Card mirrors LayerManager (createRoot, targetId, bus-only, adapters/lib split; shared bus wrappers hoisted to `_shared/adapters/`). ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code matching the shipped files. ✓

**Type consistency:** `resolveImageUrl`/`resolveLinkUrl`/`buildCardData` all live in `adapters/buildCardData.ts` and are consumed by `getCardData.ts`. Raw config fields (`image`/`title`/`subtitle`/`linkUrl`) map through `buildCardData` to the renderable `CardItem` (`imageUrl`/`title`/`subtitle`/`linkUrl`) used by `lib/types.ts`, `Card`, and `CardList`. The generic upload route returns `{ status, path }`; `uploadCardImage` and `UploadField` consume `path`/`message` consistently. ✓

**As-built notes (verified against the shipped branch):**
- Backend is the generic `API/Backend/Upload/` service (`setup.js`, `uploadRouter.js`, `validate.js`), mounted at `/api/upload` behind `s.ensureAdmin()`; there is no `API/Backend/CardPlugin/`.
- Allowed image types include SVG (`IMAGE_MIME_TO_EXT` in `API/Backend/Upload/validate.js`).
- `L_.getToolVars` key is the lowercased config `name`, i.e. `"card"` (passed as the 2nd arg to `mmgisRequest('tool:getVars', 'card')`).
- The Configure mission segment used for the upload path is `configuration?.msv?.missionFolderName || configuration?.msv?.mission`.
