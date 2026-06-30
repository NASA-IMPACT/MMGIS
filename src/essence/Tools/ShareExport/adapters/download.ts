// Small DOM helpers for triggering a browser download and reading an image's
// natural dimensions. Kept dependency-injectable (document / Image constructor)
// so the orchestration in shareActions stays unit-testable.

/**
 * Triggers a browser download of a data URL by clicking a transient anchor.
 */
export function downloadDataUrl(
    dataUrl: string,
    filename: string,
    doc: Document = document,
): void {
    const a = doc.createElement('a')
    a.href = dataUrl
    a.download = filename
    doc.body.appendChild(a)
    a.click()
    doc.body.removeChild(a)
}

export type ImageSize = { width: number; height: number }

type ImageLike = {
    onload: (() => void) | null
    onerror: (() => void) | null
    naturalWidth?: number
    naturalHeight?: number
    width?: number
    height?: number
    src: string
}

/**
 * Loads an image data URL and resolves its natural pixel dimensions. The Image
 * constructor is injectable for testing.
 */
export function loadImageSize(
    dataUrl: string,
    ImageCtor: new () => ImageLike = Image as unknown as new () => ImageLike,
): Promise<ImageSize> {
    return new Promise((resolve, reject) => {
        const img = new ImageCtor()
        img.onload = () =>
            resolve({
                width: img.naturalWidth || img.width || 0,
                height: img.naturalHeight || img.height || 0,
            })
        img.onerror = () =>
            reject(new Error('Failed to load screenshot image'))
        img.src = dataUrl
    })
}
