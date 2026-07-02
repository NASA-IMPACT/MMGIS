// Small DOM helpers for triggering browser downloads, converting image blobs,
// and reading image dimensions. Kept dependency-injectable (document / URL /
// atob / FileReader / Image constructor) so shareActions stays unit-testable.

/**
 * How long the object URL stays alive after the download is triggered. The
 * revoke must be deferred: browsers resolve the URL asynchronously after the
 * click, so revoking immediately can abort the download.
 */
const REVOKE_DELAY_MS = 10000

export type DownloadEnv = {
    doc?: Document
    /** URL.createObjectURL / URL.revokeObjectURL (jsdom lacks these). */
    urlApi?: {
        createObjectURL: (blob: Blob) => string
        revokeObjectURL: (url: string) => void
    }
    /** Deferred-callback scheduler (defaults to setTimeout). */
    schedule?: (fn: () => void, ms: number) => void
    /** Base64 decoder (defaults to the global atob). */
    atobFn?: (base64: string) => string
}

export type BlobReaderLike = {
    onload: ((event?: unknown) => void) | null
    onerror: ((event?: unknown) => void) | null
    result: string | ArrayBuffer | null
    readAsDataURL: (blob: Blob) => void
}

export type BlobReaderCtor = new () => BlobReaderLike

/**
 * Decodes a base64 data URL into a Blob of its declared MIME type.
 */
export function dataUrlToBlob(
    dataUrl: string,
    atobFn: (base64: string) => string = atob,
): Blob {
    const match = /^data:([^;,]+);base64,(.*)$/.exec(dataUrl)
    if (!match) throw new Error('Expected a base64 data URL')
    const [, mime, base64] = match
    const binary = atobFn(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
    }
    return new Blob([bytes], { type: mime })
}

/**
 * Triggers a browser download of a data URL by clicking a transient anchor.
 *
 * The data URL is converted to a Blob + object URL first: multi-megabyte
 * data:-scheme hrefs are unreliable as anchor downloads (browsers cap URL
 * length), while object URLs download dependably regardless of size. The
 * object URL is revoked on a delay so the browser has time to start the
 * download before the resource disappears.
 */
export function downloadDataUrl(
    dataUrl: string,
    filename: string,
    env: DownloadEnv = {},
): void {
    const doc = env.doc ?? document
    const urlApi = env.urlApi ?? URL
    const schedule =
        env.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))

    const blob = dataUrlToBlob(dataUrl, env.atobFn)
    const objectUrl = urlApi.createObjectURL(blob)

    const a = doc.createElement('a')
    a.href = objectUrl
    a.download = filename
    doc.body.appendChild(a)
    a.click()
    doc.body.removeChild(a)

    schedule(() => urlApi.revokeObjectURL(objectUrl), REVOKE_DELAY_MS)
}

/**
 * Triggers a browser download of a Blob by clicking a transient object URL.
 * The revoke is delayed because browsers resolve the object URL asynchronously
 * after the click, and revoking immediately can abort the download.
 */
export function downloadBlob(
    blob: Blob,
    filename: string,
    env: DownloadEnv = {},
): void {
    const doc = env.doc ?? document
    const urlApi = env.urlApi ?? URL
    const schedule =
        env.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
    const objectUrl = urlApi.createObjectURL(blob)
    const a = doc.createElement('a')
    a.href = objectUrl
    a.download = filename
    doc.body.appendChild(a)
    a.click()
    doc.body.removeChild(a)
    schedule(() => urlApi.revokeObjectURL(objectUrl), REVOKE_DELAY_MS)
}

/**
 * Converts a Blob to a data URL for APIs that still require one, such as
 * jsPDF's addImage.
 */
export function blobToDataUrl(
    blob: Blob,
    ReaderCtor: BlobReaderCtor = FileReader,
): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new ReaderCtor()
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                resolve(reader.result)
                return
            }
            reject(new Error('Failed to read screenshot Blob as data URL'))
        }
        reader.onerror = () =>
            reject(new Error('Failed to read screenshot Blob as data URL'))
        reader.readAsDataURL(blob)
    })
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
