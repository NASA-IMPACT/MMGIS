# Card Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Card plugin — a modern TSX/React sidebar tool that renders a configurable list of cards (square-cropped image, title, subtitle, link), authored in the Configure page via a new image-upload field, with images stored under `Missions/<mission>/CardPlugin/uploads/`.

**Architecture:** Three independent units. (1) A backend module `API/Backend/CardPlugin/` with one `busboy` upload route writing to the per-mission `Missions/` dir (served statically already). (2) A new reusable `upload` field type in the Configure SPA (`Maker.js`) that POSTs a file and stores the returned mission-relative path. (3) A modern Card tool (`src/essence/Tools/Card/`) mirroring `LayerManager` — `createRoot`, `targetId`, event-bus only — that reads its `cards` tool-var and renders them. Card *data* lives in mission config (existing save/load); the only new backend surface is the upload.

**Tech Stack:** Node/Express + `busboy` 1.6 (backend), React 19 + TypeScript + SCSS (tool), MUI + Redux (Configure SPA), Playwright unit specs (`tests/unit/Card/`).

**Spec:** `docs/superpowers/specs/2026-05-28-card-plugin-design.md`

**Conventions verified during planning:**
- Backend module discovery: `API/setups.js` auto-loads `API/Backend/*/setup.js`; `onceInit(s)` registers routes via `s.app.use(s.ROOT_PATH + "/api/...", s.ensureUser(), s.checkHeadersCodeInjection, s.stopGuests, router)` (see `API/Backend/Draw/setup.js`).
- `logger = require("../../../logger")` from a routes file; signature `logger(level, message, caller, req, err)`.
- Repo root from a routes file: `path.join(__dirname, "../../../../")`. `Missions/` lives at repo root and is served statically (`scripts/server.js`).
- `busboy` 1.6 API: `const busboy = require("busboy"); const bb = busboy({ headers, limits }); bb.on("file", (name, stream, info) => { info.mimeType })`. (Do NOT copy the stale 5-arg signature in `datasets.js`.)
- Tool discovery: `API/updateTools.js` globs `src/essence/Tools/*` for a `config.json`; no central registration. `config.json.paths` point to module path without extension (e.g. `essence/Tools/Card/CardTool`).
- Event-bus handlers already registered by `Layers_.fina()`: `tool:getVars` (→ `L_.getToolVars(toolName)`, key is the lowercased tool name, e.g. `"card"`) and `app:getMissionPath` (→ `L_.missionPath`, a string like `"Missions/<mission>/"` with trailing slash). See `src/essence/Basics/Layers_/Layers_.js:220-222`.
- Configure SPA: in `Maker.js` render scope, the active mission is `configuration.msv.mission`; persist via `updateConfiguration(field, value, layer)`; show errors via `dispatch(setSnackBarText({ text, severity }))`. Request base `domain` is computed as in `configure/src/core/calls.js` (dev → `http://localhost:8888/`, else `window.mmgisglobal.ROOT_PATH`).
- Playwright unit spec pattern (`tests/unit/LayerManager/handlers.spec.js`): `import { test, expect } from '@playwright/test'`, import TS source directly, mock globals (`global.window.mmgisAPI`, `global.fetch`). Run a single file with `npx playwright test <path>`.

---

### Task 1: Backend CardPlugin upload module

**Goal:** A `POST /api/cardplugin/upload?mission=<name>` route that validates and saves an image to `Missions/<mission>/CardPlugin/uploads/<uuid>.<ext>` and returns the mission-relative path, plus a pure validation module unit-tested via Playwright.

**Files:**
- Create: `API/Backend/CardPlugin/routes/validate.js`
- Test: `tests/unit/Card/uploadValidate.spec.js`
- Create: `API/Backend/CardPlugin/routes/upload.js`
- Create: `API/Backend/CardPlugin/setup.js`

**Acceptance Criteria:**
- [ ] `extensionForMime` maps allowed image MIME types to extensions and returns `null` otherwise.
- [ ] `isValidMission` rejects empty, non-string, `..`, and path-separator values; accepts plain names.
- [ ] Validation spec passes under Playwright.
- [ ] Route registered behind `ensureUser` + `stopGuests`; saves allowed images, returns `{ status: "success", path }`; rejects bad mission (400), unsupported type (400), oversize (413), missing file (400).
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
} from '../../../API/Backend/CardPlugin/routes/validate.js'

test.describe('CardPlugin upload validation', () => {
    test('extensionForMime maps allowed image types', () => {
        expect(extensionForMime('image/png')).toBe('png')
        expect(extensionForMime('image/jpeg')).toBe('jpg')
        expect(extensionForMime('image/webp')).toBe('webp')
        expect(extensionForMime('image/gif')).toBe('gif')
    })

    test('extensionForMime rejects disallowed types', () => {
        expect(extensionForMime('image/svg+xml')).toBeNull()
        expect(extensionForMime('application/pdf')).toBeNull()
        expect(extensionForMime(undefined)).toBeNull()
    })

    test('isValidMission accepts plain names', () => {
        expect(isValidMission('MSL')).toBe(true)
        expect(isValidMission('My_Mission-1')).toBe(true)
    })

    test('isValidMission rejects traversal and separators', () => {
        expect(isValidMission('')).toBe(false)
        expect(isValidMission('..')).toBe(false)
        expect(isValidMission('a/../b')).toBe(false)
        expect(isValidMission('a/b')).toBe(false)
        expect(isValidMission('a\\b')).toBe(false)
        expect(isValidMission(null)).toBe(false)
        expect(isValidMission(42)).toBe(false)
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/unit/Card/uploadValidate.spec.js`
Expected: FAIL — cannot resolve `validate.js` (module does not exist yet).

- [ ] **Step 3: Implement the validation module**

Create `API/Backend/CardPlugin/routes/validate.js`:

```js
// Pure validation helpers for the CardPlugin image upload route.

const ALLOWED_MIME_TO_EXT = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
};

// Map an upload mimetype to a safe file extension, or null if not allowed.
// SVG is intentionally excluded (stored-XSS vector).
function extensionForMime(mimeType) {
    if (typeof mimeType !== 'string') return null;
    return ALLOWED_MIME_TO_EXT[mimeType.toLowerCase()] || null;
}

// Reject anything that could escape the Missions/<mission> directory.
function isValidMission(mission) {
    if (typeof mission !== 'string') return false;
    if (mission.trim() === '') return false;
    if (mission.includes('..')) return false;
    if (mission.includes('/') || mission.includes('\\')) return false;
    return true;
}

module.exports = { ALLOWED_MIME_TO_EXT, extensionForMime, isValidMission };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/unit/Card/uploadValidate.spec.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Implement the upload route**

Create `API/Backend/CardPlugin/routes/upload.js`:

```js
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const busboy = require('busboy');
const logger = require('../../../logger');
const { extensionForMime, isValidMission } = require('./validate');

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB
const MISSIONS_DIR = path.join(__dirname, '../../../../Missions');

// POST /api/cardplugin/upload?mission=<name>  (multipart, field name "image")
router.post('/upload', function (req, res) {
    const mission = req.query.mission;
    if (!isValidMission(mission)) {
        return res
            .status(400)
            .json({ status: 'failure', message: 'Invalid or missing mission' });
    }

    const missionDir = path.join(MISSIONS_DIR, mission);
    if (!fs.existsSync(missionDir)) {
        return res
            .status(400)
            .json({ status: 'failure', message: 'Mission not found' });
    }

    let bb;
    try {
        bb = busboy({
            headers: req.headers,
            limits: { files: 1, fileSize: MAX_FILE_BYTES },
        });
    } catch (err) {
        return res
            .status(400)
            .json({ status: 'failure', message: 'Invalid upload request' });
    }

    let responded = false;
    const fail = (code, message, err) => {
        if (err)
            logger('error', `CardPlugin upload: ${message}`, 'CardPlugin', req, err);
        if (responded) return;
        responded = true;
        res.status(code).json({ status: 'failure', message });
    };

    let savedRelPath = null;
    let destPath = null;

    bb.on('file', (name, file, info) => {
        const ext = extensionForMime(info && info.mimeType);
        if (!ext) {
            file.resume(); // drain so the request can finish
            return fail(400, 'Unsupported image type');
        }

        const uploadsDir = path.join(missionDir, 'CardPlugin', 'uploads');
        try {
            fs.mkdirSync(uploadsDir, { recursive: true });
        } catch (err) {
            file.resume();
            return fail(500, 'Failed to create uploads directory', err);
        }

        const filename = `${crypto.randomUUID()}.${ext}`;
        destPath = path.join(uploadsDir, filename);
        savedRelPath = `CardPlugin/uploads/${filename}`;

        const writeStream = fs.createWriteStream(destPath);
        file.pipe(writeStream);

        file.on('limit', () => {
            writeStream.destroy();
            fs.unlink(destPath, () => {});
            savedRelPath = null;
            fail(413, 'Image exceeds 5MB limit');
        });
        writeStream.on('error', (err) => {
            fs.unlink(destPath, () => {});
            savedRelPath = null;
            fail(500, 'Failed to save image', err);
        });
    });

    bb.on('error', (err) => fail(500, 'Upload failed', err));

    bb.on('close', () => {
        if (responded) return;
        if (!savedRelPath) return fail(400, 'No image provided');
        responded = true;
        res.status(200).json({ status: 'success', path: savedRelPath });
    });

    req.pipe(bb);
});

module.exports = router;
```

- [ ] **Step 6: Implement the setup module**

Create `API/Backend/CardPlugin/setup.js`:

```js
const router = require('./routes/upload');

let setup = {
    // Once the app initializes
    onceInit: (s) => {
        s.app.use(
            s.ROOT_PATH + '/api/cardplugin',
            s.ensureUser(),
            s.checkHeadersCodeInjection,
            s.stopGuests,
            router
        );
    },
    // Once the server starts
    onceStarted: (s) => {},
    // Once all tables sync
    onceSynced: (s) => {},
};

module.exports = setup;
```

> Note: deliberately omit `s.setContentType` from this chain — it is used elsewhere for JSON request bodies and can interfere with multipart parsing. The route sets its own response content-type via `res.json`.

- [ ] **Step 7: Manually verify route registration**

Run: `node -e "require('./API/Backend/CardPlugin/setup.js'); console.log('setup loads OK')"`
Expected: prints `setup loads OK` with no require errors.

- [ ] **Step 8: Commit**

```bash
git add API/Backend/CardPlugin/ tests/unit/Card/uploadValidate.spec.js
git commit -m "feat(cardplugin): add backend image upload route"
```

---

### Task 2: `upload` config field type in the Configure SPA

**Goal:** Add a reusable `upload` field type so admins can upload an image (instead of typing a path) anywhere in the config schema, including inside an `objectarray`. The field POSTs to the Task 1 route and stores the returned mission-relative path.

**Files:**
- Create: `configure/src/core/cardUpload.js`
- Test: `tests/unit/Card/uploadImage.spec.js`
- Create: `configure/src/core/components/UploadField.js`
- Modify: `configure/src/core/Maker.js` (add `case "upload"` in the component-render switch)

**Acceptance Criteria:**
- [ ] `uploadCardImage(file, mission)` POSTs `multipart/form-data` (field `image`) to `${domain}api/cardplugin/upload?mission=<mission>` and resolves to the returned `path`; throws on non-success.
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
        expect(calledUrl).toBe('api/cardplugin/upload?mission=MSL')
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

// Uploads an image File to the CardPlugin route for `mission`.
// Resolves with the stored mission-relative path, or throws with the
// server's error message.
export async function uploadCardImage(file, mission) {
    const form = new FormData();
    form.append('image', file);

    const url = `${getDomain()}api/cardplugin/upload?mission=${encodeURIComponent(
        mission,
    )}`;
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
                    accept="image/png,image/jpeg,image/webp,image/gif"
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
          mission={configuration?.msv?.mission}
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

> `fieldValue`, `com`, `configuration`, `disabled`, `isDisabled`, `forceField`, `layer`, `updateConfiguration`, `dispatch`, and `setSnackBarText` are all already in scope in this function (confirmed against `case "text":` and `case "button":`).

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

### Task 3: Card tool scaffold, adapters, and image-URL resolver

**Goal:** Register the Card tool so it mounts in the sidebar (modern pattern: `createRoot`, `targetId`, event-bus only), reads its `cards` tool-var, and exposes a unit-tested pure helper to resolve a mission-relative image path to an absolute URL. The panel renders a loading/empty state at this stage (real card UI lands in Task 4).

**Files:**
- Create: `src/essence/Tools/Card/adapters/mmgisAPI.ts`
- Create: `src/essence/Tools/Card/adapters/useMMGISToolVars.ts`
- Create: `src/essence/Tools/Card/lib/types.ts`
- Create: `src/essence/Tools/Card/lib/resolveImageUrl.ts`
- Test: `tests/unit/Card/resolveImageUrl.spec.js`
- Create: `src/essence/Tools/Card/config.json`
- Create: `src/essence/Tools/Card/CardTool.tsx`
- Create: `src/essence/Tools/Card/MMGISCardAdapter.tsx`

**Acceptance Criteria:**
- [ ] `resolveImageUrl(image, missionPath)` returns `''` for empty input, passes through absolute/`data:`/root-relative URLs unchanged, and prefixes mission-relative paths with `missionPath`.
- [ ] Resolver spec passes.
- [ ] `config.json` declares the tool, the `cards` `objectarray` (with an `upload` image sub-field), and modern-layout `metadata`.
- [ ] `CardTool.tsx` mounts/unmounts a React root into `targetId` and cleans up on `destroy`.

**Verify:** `npx playwright test tests/unit/Card/resolveImageUrl.spec.js` → passes.

**Steps:**

- [ ] **Step 1: Write the failing resolver test**

Create `tests/unit/Card/resolveImageUrl.spec.js`:

```js
import { test, expect } from '@playwright/test'
import { resolveImageUrl } from '../../../src/essence/Tools/Card/lib/resolveImageUrl.ts'

test.describe('resolveImageUrl', () => {
    test('returns empty string for empty input', () => {
        expect(resolveImageUrl('', 'Missions/MSL/')).toBe('')
        expect(resolveImageUrl(undefined, 'Missions/MSL/')).toBe('')
    })

    test('passes through absolute and data URLs', () => {
        expect(resolveImageUrl('https://x/y.png', 'Missions/MSL/')).toBe('https://x/y.png')
        expect(resolveImageUrl('http://x/y.png', 'Missions/MSL/')).toBe('http://x/y.png')
        expect(resolveImageUrl('data:image/png;base64,AAAA', 'Missions/MSL/')).toBe('data:image/png;base64,AAAA')
        expect(resolveImageUrl('/already/rooted.png', 'Missions/MSL/')).toBe('/already/rooted.png')
    })

    test('prefixes mission-relative paths with the mission path', () => {
        expect(resolveImageUrl('CardPlugin/uploads/a.png', 'Missions/MSL/')).toBe(
            'Missions/MSL/CardPlugin/uploads/a.png',
        )
    })

    test('tolerates a null mission path', () => {
        expect(resolveImageUrl('CardPlugin/uploads/a.png', null)).toBe(
            'CardPlugin/uploads/a.png',
        )
    })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test tests/unit/Card/resolveImageUrl.spec.js`
Expected: FAIL — `resolveImageUrl.ts` does not exist.

- [ ] **Step 3: Implement the resolver**

Create `src/essence/Tools/Card/lib/resolveImageUrl.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx playwright test tests/unit/Card/resolveImageUrl.spec.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Create the types module**

Create `src/essence/Tools/Card/lib/types.ts`:

```ts
export type Card = {
    image?: string
    title?: string
    subtitle?: string
    linkUrl?: string
}
```

- [ ] **Step 6: Copy the event-bus adapters from LayerManager**

Create `src/essence/Tools/Card/adapters/mmgisAPI.ts` with the exact contents of `src/essence/Tools/LayerManager/adapters/mmgisAPI.ts` (the `mmgisRequest`/`mmgisOn`/`mmgisEmit`/`mmgisProvide`/`mmgisHasHandler` wrappers and the `Window.mmgisAPI` type). It is generic and tool-agnostic — copy verbatim.

Create `src/essence/Tools/Card/adapters/useMMGISToolVars.ts` with the exact contents of `src/essence/Tools/LayerManager/adapters/useMMGISToolVars.ts` (the `useMMGISToolVars<T>(toolName)` hook). Copy verbatim.

- [ ] **Step 7: Create the tool config**

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
                                "description": "Upload an image (png/jpg/webp/gif, &le;5MB). It is cropped to a square in the card.",
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
                                "description": "URL opened when the card is clicked.",
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
import $ from 'jquery'
import { createRoot, type Root } from 'react-dom/client'
import { MMGISCardAdapter } from './MMGISCardAdapter'
import { mmgisRequest } from './adapters/mmgisAPI'

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
        $(container).css('background', 'var(--color-k)')
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

- [ ] **Step 9: Create the adapter (loading/empty state for now)**

Create `src/essence/Tools/Card/MMGISCardAdapter.tsx`:

```tsx
import React from 'react'
import { useMMGISToolVars } from './adapters/useMMGISToolVars'
import type { Card } from './lib/types'

type ToolVars = { cards?: Card[] }

export function MMGISCardAdapter() {
    const toolVars = useMMGISToolVars<ToolVars>('card')
    const cards = Array.isArray(toolVars.cards) ? toolVars.cards : []

    // Real card rendering is added in Task 4.
    return (
        <div style={{ padding: 8 }}>
            {cards.length === 0 ? null : <div>{cards.length} card(s)</div>}
        </div>
    )
}
```

- [ ] **Step 10: Verify the tool typechecks and is discovered**

Run: `npx tsc --noEmit -p tsconfig.json` (expect no new errors from `src/essence/Tools/Card/`).
Run: `node API/updateTools.js && grep -c "Card" src/pre/tools.js`
Expected: `updateTools.js` runs without error and `src/pre/tools.js` now references the Card tool (count ≥ 1).

> If `tsc --noEmit` surfaces pre-existing repo errors unrelated to Card, confirm only that no error paths include `Tools/Card/`. (The repo suppresses TS checks on legacy files — see commit `d69fe8cf`.)

- [ ] **Step 11: Commit**

```bash
git add src/essence/Tools/Card/ tests/unit/Card/resolveImageUrl.spec.js
git commit -m "feat(cardplugin): scaffold modern Card tool and image-url resolver"
```

---

### Task 4: Card presentational components, styling, and final wiring

**Goal:** Render the cards per the Figma — square `object-fit: cover` image, title, subtitle, whole card linking out — and wire the adapter to resolve image URLs via the `app:getMissionPath` handler.

**Files:**
- Create: `src/essence/Tools/Card/lib/Card.tsx`
- Create: `src/essence/Tools/Card/lib/CardList.tsx`
- Create: `src/essence/Tools/Card/lib/index.ts`
- Create: `src/essence/Tools/Card/lib/styles/card.scss`
- Modify: `src/essence/Tools/Card/MMGISCardAdapter.tsx`

**Acceptance Criteria:**
- [ ] `Card` renders an `<a>` wrapping a 65×65 `object-fit: cover` image, the title, and the subtitle; uses `target="_blank"` + `rel="noopener noreferrer"`; renders nothing when both title and image are empty.
- [ ] `CardList` maps cards to `Card`s; empty list → empty container.
- [ ] Adapter resolves each card's `image` to an absolute URL using the mission path from `app:getMissionPath`.
- [ ] Styling matches the Figma tokens (colors/typography/spacing) from the spec.

**Verify:** `npx tsc --noEmit -p tsconfig.json` (no new `Tools/Card/` errors) + manual check (Step 6).

**Steps:**

- [ ] **Step 1: Create the card styles**

Create `src/essence/Tools/Card/lib/styles/card.scss`:

```scss
.cardPlugin {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px;
    box-sizing: border-box;
    width: 100%;
    font-family: 'Public Sans', sans-serif;
}

.cardPlugin__card {
    box-sizing: border-box;
    display: flex;
    flex-direction: row;
    align-items: flex-start;
    gap: 12px;
    padding: 16px;
    background: #f2f5f7;
    border: 1px solid #dfe1e2;
    text-decoration: none;
    width: 100%;
}

.cardPlugin__image {
    flex: none;
    width: 65px;
    height: 65px;
    object-fit: cover;
    background: #dfe1e2;
}

.cardPlugin__body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
}

.cardPlugin__title {
    font-size: 14px;
    line-height: 160%;
    color: #0d313d;
}

.cardPlugin__subtitle {
    font-size: 12px;
    line-height: 160%;
    color: #565c65;
}
```

- [ ] **Step 2: Create the Card component**

Create `src/essence/Tools/Card/lib/Card.tsx`:

```tsx
import React from 'react'
import './styles/card.scss'

type CardProps = {
    imageUrl: string
    title?: string
    subtitle?: string
    linkUrl?: string
}

export function Card({ imageUrl, title, subtitle, linkUrl }: CardProps) {
    if (!title && !imageUrl) return null
    return (
        <a
            className="cardPlugin__card"
            href={linkUrl || undefined}
            target="_blank"
            rel="noopener noreferrer"
        >
            {imageUrl ? (
                <img className="cardPlugin__image" src={imageUrl} alt={title || ''} />
            ) : (
                <div className="cardPlugin__image" />
            )}
            <div className="cardPlugin__body">
                {title ? <div className="cardPlugin__title">{title}</div> : null}
                {subtitle ? (
                    <div className="cardPlugin__subtitle">{subtitle}</div>
                ) : null}
            </div>
        </a>
    )
}
```

- [ ] **Step 3: Create the CardList component**

Create `src/essence/Tools/Card/lib/CardList.tsx`:

```tsx
import React from 'react'
import { Card } from './Card'

type CardListItem = {
    imageUrl: string
    title?: string
    subtitle?: string
    linkUrl?: string
}

export function CardList({ cards }: { cards: CardListItem[] }) {
    return (
        <div className="cardPlugin">
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

- [ ] **Step 4: Create the lib barrel**

Create `src/essence/Tools/Card/lib/index.ts`:

```ts
export { Card } from './Card'
export { CardList } from './CardList'
export { resolveImageUrl } from './resolveImageUrl'
export type { Card as CardData } from './types'
```

- [ ] **Step 5: Wire the adapter to resolve image URLs and render the list**

Replace the contents of `src/essence/Tools/Card/MMGISCardAdapter.tsx`:

```tsx
import React from 'react'
import { useEffect, useState } from 'react'
import { CardList } from './lib'
import { resolveImageUrl } from './lib/resolveImageUrl'
import type { Card } from './lib/types'
import { useMMGISToolVars } from './adapters/useMMGISToolVars'
import { mmgisRequest } from './adapters/mmgisAPI'

type ToolVars = { cards?: Card[] }

export function MMGISCardAdapter() {
    const toolVars = useMMGISToolVars<ToolVars>('card')
    const [missionPath, setMissionPath] = useState<string | null>(null)

    useEffect(() => {
        let cancelled = false
        mmgisRequest<string>('app:getMissionPath')
            .then((p) => {
                if (!cancelled && typeof p === 'string') setMissionPath(p)
            })
            .catch(() => {
                /* leave missionPath null; relative paths render as-is */
            })
        return () => {
            cancelled = true
        }
    }, [])

    const cards = (Array.isArray(toolVars.cards) ? toolVars.cards : []).map(
        (card) => ({
            imageUrl: resolveImageUrl(card.image, missionPath),
            title: card.title,
            subtitle: card.subtitle,
            linkUrl: card.linkUrl,
        }),
    )

    return <CardList cards={cards} />
}
```

- [ ] **Step 6: Verify typecheck and manual rendering**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no new errors from `src/essence/Tools/Card/`.

Manual check (hot-reload dev server is typically already running per AGENTS.md):
1. In the Configure page, add the **Card** tool to a mission's toolbar; add 2 cards, uploading a real image for each and filling title/subtitle/link; save.
2. Open the mission in the map app; open the Card tool from the sidebar.
3. Confirm each card shows a square-cropped image, title, subtitle, and that clicking opens the link in a new tab. Confirm an uploaded image is reachable at `/Missions/<mission>/CardPlugin/uploads/<uuid>.<ext>`.

- [ ] **Step 7: Commit**

```bash
git add src/essence/Tools/Card/
git commit -m "feat(cardplugin): render cards with square images, title, subtitle, link"
```

---

## Self-Review

**Spec coverage:**
- Card plugin in sidebar → Tasks 3–4 (modern tool, `metadata` left/right vertical). ✓
- Admin config: image upload, title, subtitle, link → Task 3 `config.json` `objectarray` + Task 2 `upload` field. ✓
- Image upload to `uploads/` folder on disk (per-mission) → Task 1 writes `Missions/<mission>/CardPlugin/uploads/`. ✓ (Reconciled the spec's "within the plugin folder" with the reality that the bundled tool dir is not writable/served.)
- Future S3 → documented out-of-scope; upload route is the swap seam. ✓
- Cropped to square automatically → CSS `object-fit: cover` in `card.scss`. ✓
- List of cards → `objectarray` + `CardList`. ✓
- Reference slesaad's modern pattern → Card mirrors LayerManager (createRoot, targetId, bus-only, adapters/lib split). ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; the only "copy verbatim" steps (Task 3 Step 6) reference concrete existing files. ✓

**Type consistency:** `resolveImageUrl(image, missionPath)` used identically in spec (Task 3) and adapter (Task 4). `Card` type fields (`image`/`title`/`subtitle`/`linkUrl`) consistent across `types.ts`, `config.json`, adapter mapping, and `CardList` item shape (`imageUrl` after resolution). Upload route returns `{ status, path }`; `uploadCardImage` and `UploadField` consume `path`/`message` consistently. ✓

**Open items deferred to execution (verify, don't assume):**
- `L_.getToolVars` key casing — confirm `"card"` matches the lowercased config `name` (LayerManager precedent: `"layermanager"`). If it differs, adjust the `useMMGISToolVars('card')` argument.
- Configure build command in Task 2 Step 7 — use whatever `configure/package.json` `scripts.build` defines.
