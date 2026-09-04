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

// A copy of ASSETS_UPLOAD_KEY in API/Backend/Upload/validate.js; see it for
// the shape this matches, why, and why each bundle carries its own copy.
// src/pre/uploadKey.ts carries the third.
export const ASSETS_UPLOAD_KEY = /^assets\/[^/]+\/[^/]+\/uploads\//;

// Turns a stored upload-field value into the URL the CMS's preview <img>
// should use: the same four cases as resolveMissionAssetUrl in
// src/pre/uploadKey.ts, in the same order, but anchored to `base` — a
// trailing-slashed base URL, as returned by getApiBase() — rather than left
// to the page to resolve.
//
// An upload key hangs straight off that base because the admin CloudFront
// serves /assets/* from the shared bucket; everything else is under
// "Missions/<mission>/". A base that is empty or missing its trailing slash
// is given one, so the preview URL stays root-anchored and names the same
// file however deep the CMS is mounted.
export function buildPreviewSrc(value, mission, base) {
    // Callers feed this runtime configuration JSON, so the type is a runtime
    // question.
    if (typeof value !== 'string' || !value) return '';
    if (/^(https?:|data:)/i.test(value)) return value;
    const root = !base ? '/' : base.endsWith('/') ? base : `${base}/`;
    const rooted = value.startsWith('/');
    const rebased = rooted ? value.slice(1) : value;
    if (ASSETS_UPLOAD_KEY.test(rebased)) return `${root}${rebased}`;
    if (rooted) return value;
    return `${root}Missions/${mission}/${value}`;
}
