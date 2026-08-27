import { getApiBase } from './urls';

// Uploads an image File to the generic core upload endpoint, under the given
// `mission` and `subdir` (the caller — e.g. a plugin's config field — names its
// own subdir). Resolves with the stored path — mission-relative
// ("<subdir>/uploads/<file>") on disk, or a document-relative
// "assets/<mission>/<subdir>/uploads/<file>" key when the S3 asset bucket is
// configured (see API/Backend/Upload/uploadRouter.js) — or throws with the
// server's error message.
export async function uploadImage(file, mission, subdir) {
    const form = new FormData();
    form.append('image', file);

    const url = `${getApiBase()}api/upload?mission=${encodeURIComponent(
        mission,
    )}&subdir=${encodeURIComponent(subdir)}`;
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

// Mirrors ASSETS_UPLOAD_KEY in
// src/essence/Tools/Card/adapters/buildCardData.ts.
const ASSETS_UPLOAD_KEY = /^assets\/[^/]+\/[^/]+\/uploads\//;

// Resolves a stored upload-field value to a previewable URL for the CMS.
// Absolute/data values pass through unchanged. Values matching
// ASSETS_UPLOAD_KEY are resolved against `base`, where the admin CloudFront
// serves /assets/* from the shared bucket; a legacy rooted "/assets/..."
// value is rebased to that same slash-less shape before the test. The CMS is
// always server-hosted, so `base || '/'` is root-absolute when there is no
// ROOT_PATH base to prefix with — mission-relative values are anchored the
// same way, since a document-relative preview URL would resolve against
// whatever path the CMS is currently visited at (e.g. '/configure/') and
// 404. Any other already-rooted value passes through unchanged.
export function buildPreviewSrc(value, mission, base) {
    if (!value) return '';
    if (/^(https?:|data:)/i.test(value)) return value;
    const rooted = value.startsWith('/');
    const rebased = rooted ? value.slice(1) : value;
    if (ASSETS_UPLOAD_KEY.test(rebased)) return `${base || '/'}${rebased}`;
    if (rooted) return value;
    return `${base || '/'}Missions/${mission}/${value}`;
}
