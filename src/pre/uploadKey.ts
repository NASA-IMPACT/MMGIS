// Is this stored value one of our lean-mode uploads? Those are written by
// API/Backend/Upload/uploadRouter.js and always look exactly like
//
//   assets/<mission>/<subdir>/uploads/<file>
//
// so this matches "assets/", then exactly two path segments, then
// "/uploads/". The exactness matters: a plugin whose subdir happens to be
// named "assets" would store ordinary mission-relative values like
// "assets/uploads/x.png", and a looser test ("starts with assets/") would
// grab those too and resolve them against the wrong root. Requiring both
// middle segments keeps the two shapes apart.
//
// The Configure app needs the same test for its upload previews, but it is
// a separate bundle that can't import from this one, so the regex is
// written twice: here and ASSETS_UPLOAD_KEY in configure/src/core/upload.js.
// tests/unit/uploadPreviewSrc.spec.js fails if the two copies ever differ.
const ASSETS_UPLOAD_KEY = /^assets\/[^/]+\/[^/]+\/uploads\//

// Turns a stored asset value — a tool's uploaded image, icon, or file — into
// the URL the browser should request. The stored value can be one of four
// things, checked in this order:
//
//   - a full URL ("https://..." or "data:...") — used as-is.
//
//   - a lean-mode upload key ("assets/MSL/CardPlugin/uploads/a.png" — the
//     shape ASSETS_UPLOAD_KEY matches) — returned still slash-less, so the
//     browser resolves it against the page's own folder. That folder is
//     always the dashboard's root: the page is only ever served as
//     <root>/ or <root>/index.html, and the admin serves from the origin
//     root. A legacy value from before the slash-less contract
//     ("/assets/...") is the same thing with a leading slash; the slash is
//     stripped before the test so it takes this branch too.
//
//   - any other rooted path ("/somewhere/else.png") — used as-is.
//
//   - anything else ("CardPlugin/uploads/a.png") — a mission-relative path,
//     prefixed with the mission path ("Missions/MSL/"). This includes an
//     "assets/..." value that doesn't match the writer's exact shape, on
//     purpose — see the regex comment above.
export function resolveMissionAssetUrl(
    value: string | undefined | null,
    missionPath: string | null,
): string {
    if (!value) return ''
    if (typeof value !== 'string') return ''
    if (/^(https?:|data:)/i.test(value)) return value
    const rooted = value.startsWith('/')
    const rebased = rooted ? value.slice(1) : value
    if (ASSETS_UPLOAD_KEY.test(rebased)) return rebased
    if (rooted) return value
    return (missionPath || '') + value
}
