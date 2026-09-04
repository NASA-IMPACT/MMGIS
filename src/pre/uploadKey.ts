/**
 * uploadKey.ts
 * The single place the Essence bundle turns a stored upload-field value
 * into a URL, so every plugin with an `upload` field resolves it the same
 * way.
 */

// Is this stored value one of the keys API/Backend/Upload/uploadRouter.js
// writes when the S3 asset bucket is configured? This is a copy of
// ASSETS_UPLOAD_KEY in API/Backend/Upload/validate.js; see it for the shape
// this matches, why, and why each bundle carries its own copy.
// configure/src/core/upload.js carries the third.
const ASSETS_UPLOAD_KEY = /^assets\/[^/]+\/[^/]+\/uploads\//

// A matched key comes back slash-less so the browser resolves it against the
// page's own folder, which is always the dashboard's root: the page is served
// only as <root>/ or <root>/index.html (the slash-less entry URL gets
// redirected), and the admin serves from the origin root.
export function resolveMissionAssetUrl(
    value: string | undefined | null,
    missionPath: string | null,
): string {
    if (!value) return ''
    if (/^(https?:|data:)/i.test(value)) return value
    const rooted = value.startsWith('/')
    const rebased = rooted ? value.slice(1) : value
    if (ASSETS_UPLOAD_KEY.test(rebased)) return rebased
    if (rooted) return value
    return (missionPath || '') + value
}
