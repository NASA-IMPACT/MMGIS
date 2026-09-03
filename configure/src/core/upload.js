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

// The CMS is a separate bundle with no import path into the app's, so this
// is a copy of ASSETS_UPLOAD_KEY in src/pre/uploadKey.ts, where the shape it
// matches is explained. scripts/lib/aws-provision.js carries a third copy, a
// CommonJS module run by Node. tests/unit/uploadKeyClassifier.spec.js runs one
// table of values through all three and fails if they classify any of them
// differently.
const ASSETS_UPLOAD_KEY = /^assets\/[^/]+\/[^/]+\/uploads\//;

// Turns a stored upload-field value into the URL the CMS's preview <img>
// should use: the same four cases as resolveMissionAssetUrl in
// src/pre/uploadKey.ts, in the same order, but anchored to `base` (the
// ROOT_PATH prefix, or '/' when unset) rather than to the page. The CMS
// cannot go document-relative: it is served under its own path (e.g.
// '/configure/'), so a relative preview src would resolve there and 404. An
// upload key therefore comes back as `base` + the key — the admin CloudFront
// serves /assets/* from the shared bucket — and a mission-relative value as
// `base` + "Missions/<mission>/" + the value. A rooted "/assets/..." value is
// the same key with a leading slash, stripped before the test.
export function buildPreviewSrc(value, mission, base) {
    if (!value) return '';
    if (typeof value !== 'string') return '';
    if (/^(https?:|data:)/i.test(value)) return value;
    const rooted = value.startsWith('/');
    const rebased = rooted ? value.slice(1) : value;
    if (ASSETS_UPLOAD_KEY.test(rebased)) return `${base || '/'}${rebased}`;
    if (rooted) return value;
    return `${base || '/'}Missions/${mission}/${value}`;
}
