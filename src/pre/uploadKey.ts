/**
 * uploadKey.ts
 * The single place the Essence bundle turns a stored upload-field value
 * into a URL, so every plugin with an `upload` field resolves it the same
 * way.
 */

// Is this stored value one of the keys API/Backend/Upload/uploadRouter.js
// writes when the S3 asset bucket is configured? Those look exactly like
//
//   assets/<mission>/<subdir>/uploads/<file>
//
// so this matches "assets/", then exactly two path segments, then
// "/uploads/". The exactness matters: a plugin whose subdir is itself named
// "assets" stores ordinary mission-relative values like
// "assets/uploads/x.png", and a looser test ("starts with assets/") would
// grab those too and resolve them against the wrong root.
//
// configure/src/core/upload.js carries its own copy of this regex — the CMS
// is a separate bundle with no import path into this one.
// tests/unit/uploadKeyClassifier.spec.js runs one table of values through
// both and fails if they classify any of them differently.
export const ASSETS_UPLOAD_KEY = /^assets\/[^/]+\/[^/]+\/uploads\//

// What URL should the page request for a stored value? Four cases, checked
// in this order:
//
//   - a full URL ("https://..." or "data:...") — used as-is.
//   - an upload key ("assets/MSL/CardPlugin/uploads/a.png") — returned still
//     slash-less, so the browser resolves it against the page's own folder.
//     That folder is always the dashboard's root: the page is served only as
//     <root>/ or <root>/index.html (the slash-less entry URL gets
//     redirected), and the admin serves from the origin root. A rooted
//     "/assets/..." value is the same key with a leading slash, stripped
//     before the test, so it takes this branch too.
//   - any other rooted path ("/somewhere/else.png") — used as-is.
//   - anything else ("CardPlugin/uploads/a.png") — a mission-relative path,
//     prefixed with the mission path ("Missions/MSL/"). This includes an
//     "assets/..." value that misses the writer's exact shape, on purpose —
//     see the regex above.
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
