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

// Same test as ASSETS_UPLOAD_KEY in
// src/essence/Tools/Card/adapters/buildCardData.ts — the full story of the
// shape, and why it is written twice, lives there.
// tests/unit/uploadPreviewSrc.spec.js fails if the two copies ever differ.
const ASSETS_UPLOAD_KEY = /^assets\/[^/]+\/[^/]+\/uploads\//;

// Turns a stored upload-field value into the URL the CMS's preview <img>
// should use. Same four cases as resolveImageUrl in
// src/essence/Tools/Card/adapters/buildCardData.ts, checked in the same
// order — but anchored differently. The CMS knows where it lives (`base`
// is the ROOT_PATH prefix, or '/' when unset), while the page's own URL
// is untrustworthy: a relative preview src would resolve against whatever
// path the admin is visiting (e.g. '/configure/') and 404. So the values
// that point at our own storage get `base` glued on the front:
//
//   - a full URL ("https://..." or "data:...") — used as-is.
//
//   - a lean-mode upload key ("assets/<mission>/<subdir>/uploads/<file>")
//     — returned as `base` + the key; the admin CloudFront serves
//     /assets/* from the shared bucket. A legacy value from before the
//     slash-less contract ("/assets/...") is the same thing with a
//     leading slash; the slash is stripped before the test so it takes
//     this branch too.
//
//   - any other rooted path ("/somewhere/else.png") — used as-is.
//
//   - anything else ("CardPlugin/uploads/a.png") — a mission-relative
//     path, returned as `base` + "Missions/<mission>/" + the value.
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
