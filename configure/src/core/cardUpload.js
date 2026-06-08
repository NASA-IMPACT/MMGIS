// Computes the API base the same way configure/src/core/calls.js does.
function getDomain() {
    let d =
        window.mmgisglobal && window.mmgisglobal.NODE_ENV === 'development'
            ? 'http://localhost:8888/'
            : (window.mmgisglobal && window.mmgisglobal.ROOT_PATH) || '';
    if (d.length > 0 && !d.endsWith('/')) d += '/';
    return d;
}

// Uploads an image File to the generic core upload endpoint for `mission`,
// under the card plugin's own `subdir`. Resolves with the stored
// mission-relative path, or throws with the server's error message.
export async function uploadCardImage(file, mission) {
    const form = new FormData();
    form.append('image', file);

    const url = `${getDomain()}api/upload?mission=${encodeURIComponent(
        mission,
    )}&subdir=CardPlugin`;
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
