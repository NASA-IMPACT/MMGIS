// Computes the API base the same way configure/src/core/calls.js does.
function getDomain() {
    let d =
        window.mmgisglobal && window.mmgisglobal.NODE_ENV === 'development'
            ? 'http://localhost:8888/'
            : (window.mmgisglobal && window.mmgisglobal.ROOT_PATH) || '';
    if (d.length > 0 && !d.endsWith('/')) d += '/';
    return d;
}

// Uploads an image File to the generic core upload endpoint, under the given
// `mission` and `subdir` (the caller — e.g. a plugin's config field — names its
// own subdir). Resolves with the stored mission-relative path, or throws with
// the server's error message.
export async function uploadImage(file, mission, subdir) {
    const form = new FormData();
    form.append('image', file);

    const url = `${getDomain()}api/upload?mission=${encodeURIComponent(
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
