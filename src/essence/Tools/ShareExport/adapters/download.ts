// Small DOM helpers for triggering browser downloads and converting image
// blobs. Kept dependency-injectable so the orchestration in shareActions stays
// unit-testable.

const REVOKE_DELAY_MS = 10000

export type DownloadBlobEnv = {
    doc?: Document
    urlApi?: {
        createObjectURL: (blob: Blob) => string
        revokeObjectURL: (url: string) => void
    }
    schedule?: (fn: () => void, ms: number) => void
}

export type BlobReaderLike = {
    onload: ((event?: unknown) => void) | null
    onerror: ((event?: unknown) => void) | null
    result: string | ArrayBuffer | null
    readAsDataURL: (blob: Blob) => void
}

export type BlobReaderCtor = new () => BlobReaderLike

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

/**
 * Triggers a browser download of a Blob by clicking a transient object URL.
 * The revoke is delayed because browsers resolve the object URL asynchronously
 * after the click, and revoking immediately can abort the download.
 */
export function downloadBlob(
    blob: Blob,
    filename: string,
    env: DownloadBlobEnv = {},
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
