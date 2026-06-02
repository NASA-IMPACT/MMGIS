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
