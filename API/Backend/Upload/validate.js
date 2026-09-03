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
// asset bucket is configured: "assets/", exactly two path segments, then
// "/uploads/". src/pre/uploadKey.ts and configure/src/core/upload.js each
// carry a copy — separate frontend bundles with no import path into this
// CommonJS module; tests/unit/uploadKeyClassifier.spec.js runs one table of
// values through all three and fails if they classify any of them differently.
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
