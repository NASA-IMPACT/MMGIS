// Small DOM helpers for triggering browser downloads and converting image
// blobs. Kept dependency-injectable (document / URL / FileReader) so
// shareActions stays unit-testable.

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
}

export type BlobReaderLike = {
    onload: ((event?: unknown) => void) | null
    onerror: ((event?: unknown) => void) | null
    result: string | ArrayBuffer | null
    readAsDataURL: (blob: Blob) => void
}

export type BlobReaderCtor = new () => BlobReaderLike

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
