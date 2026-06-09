This is an LLM artifact — a per-PR implementation doc derived from [`./00-overview.md`](./00-overview.md). Draft; verify against current code before acting.

# PR 10 — S3 asset upload repoint

> **Upload module present.** This PR edits `API/Backend/Upload/` (the #103 image-upload module). Verified on the branch: `setup.js`, `uploadRouter.js`, `validate.js` exist and are git-tracked; the single storage seam (`bb.on('file', …)` → `fs.createWriteStream` to `Missions/`) is intact; the 5 MB cap and the `isValidMission` path-traversal guard are present; and `validate.js` includes `image/svg+xml` (SVG allowed).

**Depends on:** PR 5, PR 11 (asset bucket + IAM). **Blocks:** none.

**Goal:** In `lean` mode, repoint the shared image-upload module so it writes to the admin's **shared S3 asset bucket** and returns a root-relative `/assets/…` reference, instead of writing to local `Missions/` disk — leaving `full`-mode disk behavior and all validators untouched.

> **Storage model.** Uploads land in the *shared admin* asset bucket; the route stores in config a **root-relative path** (`/assets/<mission>/…`). The admin's CloudFront serves `/assets/*` from that bucket, and Card's `resolveImageUrl` passes a leading `/` through unchanged — so it resolves same-origin. A published dashboard serves its *own* copy: **PR 8** copies the assets into the dashboard bucket under the same `/assets/…` keys at publish (same key, no URL rewrite), so the reference works against whatever origin serves the page, including a later custom domain. Bucket + IAM are **PR 11**.

## In plain English

MMGIS recently gained the ability for an admin to upload images — icons, pictures — and attach them to a mission. Today those uploaded files are saved straight onto the server's own hard drive. That works fine for the normal app, but the lean deployment is different in two ways: a published dashboard has no server and no hard drive of its own, and the lean admin itself runs in throwaway containers that can be replaced at any time. A file saved to local disk in that world would simply vanish the next time the container restarts, and a dashboard would have no way to reach it.

This PR redirects those uploads to durable cloud storage instead — a bucket the admin shares across all its missions. The admin loads images straight from there while building a mission. Then, when a mission is published as a dashboard, those images are copied into that dashboard's *own* storage (a separate step handled when the dashboard is built), so each published dashboard is completely self-contained and never depends on the admin's bucket. Nothing about *what* gets accepted changes — it reuses the exact upload code already built, with all of its safety checks intact: images only, capped in size, the mission name screened so an upload can't wander out of its folder. The only thing that changes here is where the uploaded file lands.

The normal (full) app keeps saving to local disk exactly as it does today. The new cloud-storage path only kicks in when the app is running in lean mode. That keeps this change invisible to existing deployments.

The cloud storage bucket itself, and the permission for the admin to write to it, are set up by a separate infrastructure change. This PR assumes that bucket already exists and only teaches the upload code to use it.

## Scope / files

| File | Change | Notes (verified against code) |
|---|---|---|
| `API/Backend/Upload/uploadRouter.js` *(edit, from #103)* | In `lean` mode, replace the `fs.createWriteStream` write with an S3 `PutObject` to the shared admin asset bucket (mission-scoped key, e.g. `assets/<mission>/<subdir>/uploads/<uuid>.<ext>`) and return the **root-relative `/assets/…`** path. `full` mode keeps the local-disk branch verbatim. | The single swap seam — all disk I/O is in one `bb.on('file', ...)` handler; only the destination/response there changes. |
| `API/Backend/Upload/validate.js` *(unchanged)* | No change. The MIME allow-list, extension mapping, and `isValidMission` path-traversal guard apply identically in both modes. | `validate.js` *includes* `image/svg+xml` — kept intentionally (trusted admins; decided 2026-06-08). Leave as-is. |
| `API/Backend/Upload/setup.js` *(unchanged)* | No change. | Its `onceInit` mounts the single admin route — `s.app.use(s.ROOT_PATH + '/api/upload', s.ensureAdmin(), s.checkHeadersCodeInjection, s.setContentType, createUploadRouter({ allowedMimeToExt: IMAGE_MIME_TO_EXT, routePath: '/' }))`. **The `routePath: '/'` is load-bearing** — `createUploadRouter`'s default `routePath` is `/upload`, so without it the handler would mount at `/api/upload/upload`. No per-mode change is needed here because the storage swap lives entirely inside `uploadRouter.js`; the mount point, auth posture, and allow-list wiring are mode-independent. |
| `sample.env` *(edit)* | Document the asset-bucket name env var used in `lean`; note `MISSIONS_*` vars apply only to `full` mode. | Same var name the asset bucket (PR 11) is provisioned under — keep them identical. |

## Implementation steps

1. **Confirm the module is present.** `git ls-files API/Backend/Upload/` should list `setup.js`, `uploadRouter.js`, and `validate.js` before starting.
2. **Add a mode check at the storage point only.** Inside `createUploadRouter`'s `bb.on('file', ...)` handler — after the existing extension validation and after a UUID filename is chosen — branch on the deployment-mode helper. The validation, size-limit (`file.on('limit')`), and error paths above and around it stay shared.
3. **Lean branch — write to S3.** Stream/buffer the validated file part to the asset bucket via `PutObject` under an `/assets/`-prefixed, **mission-scoped** key (e.g. `assets/<mission>/<subdir>/uploads/<uuid>.<ext>` — the shared bucket holds every mission), with the correct image `Content-Type`. Honor the same 5 MB cap busboy already enforces; on the `limit` event, abort without leaving a partial object.
4. **Lean branch — return the root-relative path.** Respond `{ status: 'success', path: '/assets/<mission>/<subdir>/uploads/<uuid>.<ext>' }`. The response *shape* stays `{ status, path }`; only the value differs. Card's `resolveImageUrl` passes the leading `/` through unchanged, so it resolves against the page's own origin — admin or dashboard — with no rebake on a later custom domain.
5. **Full branch — unchanged.** Leave the `fs.mkdirSync` + `fs.createWriteStream` + `writeStream.on('finish')` success path exactly as merged. The success response there still returns the mission-relative path.
6. **Env documentation.** In `sample.env`, add the asset-bucket name var (matching PR 11) and a comment that local-disk `MISSIONS_*` settings are full-mode only.
7. **Leave validators alone.** Do not touch `validate.js` or `setup.js`. The allow-list, extension map, and mission guard are mode-independent by design.

## Verification

- **Lean mode, happy path:** an admin image upload (png/jpg/webp/gif) results in an object in the S3 asset bucket and a `{ status: 'success', path: '/assets/…' }` response; the admin (via its `/assets/*` CloudFront behavior) serves that path; nothing is written under `Missions/`.
- **Lean mode, end-to-end:** the returned `/assets/…` path is stored in the mission config, and after publish the asset renders in the dashboard — resolved same-origin from the dashboard's own bucket (copied there by PR 8), so it works on both the `cloudfront.net` name and a later custom domain.
- **Lean mode, rejections still fire:** an unsupported MIME type → `400 Unsupported image type`; an oversize file → `413`; a mission name containing `..`/`/` → `400 Invalid or missing mission`. (These come from the unchanged validators / busboy limits, proving the swap didn't bypass them.)
- **Full mode (default / unset):** upload still lands at `Missions/<mission>/<subdir>/uploads/<uuid>.<ext>` and the response `path` is mission-relative — byte-for-byte today's behavior.
- **Grep:** the only mode branch added is at the storage point in `uploadRouter.js`; `validate.js` and `setup.js` are untouched.

## Rollback

Revert the `uploadRouter.js` edit and the `sample.env` line. Because the S3 branch is gated behind `lean` and `full` is the default, reverting restores today's local-disk behavior for every existing deployment with zero migration. Objects already written to the asset bucket are harmless if left in place.

## Implementation notes & gotchas

- **SVG allowed (decided 2026-06-08).** `validate.js` includes `image/svg+xml` — uploaders are trusted admins, and the `/assets/*` asset is served behind the deployment's gate (admin CloudFront for in-progress missions; the dashboard's password Function once published), so the residual "admin opens the raw SVG URL directly" risk is unchanged from on-disk. No validator change.
- **Root-relative resolution is Card-specific today.** Card's `resolveImageUrl` passes a leading `/` through, but `F_.isUrlAbsolute` (used by the generic layer machinery) only matches `http(s)://`/`//host` — *not* a single leading `/`. So a `/assets/…` path is safe for uploads as they're consumed now (Card images), but a future non-Card feature rendering an uploaded asset via layer code would mis-prefix it; revisit `isUrlAbsolute` if that arises.
- **Asset bucket ownership.** **PR 11** owns the asset bucket + IAM — provisioning the bucket, PutObject IAM on the admin task role, and CloudFront fronting — and is a hard dependency of this PR. No bucket or IAM is created here.
