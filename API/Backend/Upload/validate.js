// Pure validation helpers for image upload routes (see ./uploadRouter.js).

const IMAGE_MIME_TO_EXT = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    // SVG is allowed: uploaders are trusted admins, and uploaded images are
    // rendered via <img src>, which does not execute scripts embedded in an SVG.
    // (Residual risk is limited to someone opening the raw asset URL directly.)
    'image/svg+xml': 'svg',
};

// The object keys ./uploadRouter.js writes for plugin uploads when the S3
// asset bucket is configured. Those look exactly like
//
//   assets/<mission>/<subdir>/uploads/<file>
//
// so this matches "assets/", then exactly two path segments, then "/uploads/".
// The exactness matters: a plugin whose subdir is itself named "assets" stores
// ordinary mission-relative values like "assets/uploads/x.png", and a looser
// test ("starts with assets/") would grab those too and resolve them against
// the wrong root.
//
// This is the documented home of that shape. src/pre/uploadKey.ts and
// configure/src/core/upload.js each carry a copy because both frontend bundles
// restrict imports to their own src/ (webpack's ModuleScopePlugin), which puts
// this file out of reach of either. tests/unit/uploadKeyClassifier.spec.js runs
// one table of values through all three and fails if they classify any of them
// differently.
const ASSETS_UPLOAD_KEY = /^assets\/[^/]+\/[^/]+\/uploads\//;

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
    ASSETS_UPLOAD_KEY,
    extensionForMime,
    isSafePathSegment,
    isValidMission,
    isValidSubdir,
};
