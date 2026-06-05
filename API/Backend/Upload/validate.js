// Pure validation helpers for image upload routes (see ./uploadRouter.js).

const IMAGE_MIME_TO_EXT = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
};

// Map an upload mimetype to a safe file extension using the given allow-list,
// or null if the type is not allowed.
function extensionForMime(mimeType, allowedMimeToExt = IMAGE_MIME_TO_EXT) {
    if (typeof mimeType !== 'string') return null;
    return allowedMimeToExt[mimeType.toLowerCase()] || null;
}

// Reject anything that could escape the Missions/<mission> directory.
function isValidMission(mission) {
    if (typeof mission !== 'string') return false;
    if (mission.trim() === '') return false;
    if (mission.includes('..')) return false;
    if (mission.includes('/') || mission.includes('\\')) return false;
    // A pure-dot name (e.g. ".") resolves to a directory segment, so the upload
    // would land in the Missions root instead of a mission folder.
    if (/^\.+$/.test(mission)) return false;
    return true;
}

module.exports = { IMAGE_MIME_TO_EXT, extensionForMime, isValidMission };
