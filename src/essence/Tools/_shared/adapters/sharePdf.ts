// jspdf is loaded via dynamic import() inside defaultFactory so webpack
// code-splits it out of the main bundle (fetched on first PDF export) and it
// never evaluates in Node test/SSR contexts. PDF generation is owned entirely
// by this plugin — core has no PDF dependency.

export type Placement = {
    x: number
    y: number
    width: number
    height: number
}

/**
 * Computes an aspect-preserving, centered placement for an image inside a page,
 * keeping a uniform margin on all sides. The image is scaled down to fit the
 * available area; it is never scaled up beyond its natural size.
 */
export function computeCenteredPlacement(
    pageWidth: number,
    pageHeight: number,
    imageWidth: number,
    imageHeight: number,
    margin: number,
): Placement {
    const availWidth = Math.max(pageWidth - margin * 2, 0)
    const availHeight = Math.max(pageHeight - margin * 2, 0)

    // Guard against zero/invalid image dimensions.
    if (!imageWidth || !imageHeight) {
        return { x: margin, y: margin, width: availWidth, height: availHeight }
    }

    const scale = Math.min(
        availWidth / imageWidth,
        availHeight / imageHeight,
        1,
    )
    const width = imageWidth * scale
    const height = imageHeight * scale
    const x = (pageWidth - width) / 2
    const y = (pageHeight - height) / 2
    return { x, y, width, height }
}

// Minimal structural type of the jsPDF instance this helper relies on, so tests
// can inject a lightweight fake factory.
export type JsPdfLike = {
    internal: { pageSize: { getWidth: () => number; getHeight: () => number } }
    addImage: (
        data: string,
        format: string,
        x: number,
        y: number,
        width: number,
        height: number,
        alias?: string,
        compression?: string,
    ) => unknown
    save: (filename: string) => unknown
}

export type JsPdfFactory = () => JsPdfLike | Promise<JsPdfLike>

const defaultFactory: JsPdfFactory = async () => {
    const { jsPDF } = (await import('jspdf')) as unknown as {
        jsPDF: new (opts: unknown) => JsPdfLike
    }
    return new jsPDF({
        orientation: 'portrait',
        unit: 'pt',
        format: 'a4',
    })
}

export type BuildSharePdfOptions = {
    /** Uniform page margin, in pt. */
    margin?: number
    /** Injectable jsPDF factory (defaults to a portrait A4 document). */
    factory?: JsPdfFactory
}

/**
 * Builds a portrait PDF with the given PNG data URL placed centered on the page
 * (aspect preserved, fit within margins). Returns the jsPDF document so the
 * caller decides when to save/download it. Natural image dimensions must be
 * supplied by the caller (e.g. read from an Image element). Async because the
 * default factory lazy-loads jspdf via a code-split dynamic import.
 */
export async function buildSharePdf(
    dataUrl: string,
    naturalWidth: number,
    naturalHeight: number,
    options: BuildSharePdfOptions = {},
): Promise<JsPdfLike> {
    const { margin = 36, factory = defaultFactory } = options
    const doc = await factory()
    const pageWidth = doc.internal.pageSize.getWidth()
    const pageHeight = doc.internal.pageSize.getHeight()
    const { x, y, width, height } = computeCenteredPlacement(
        pageWidth,
        pageHeight,
        naturalWidth,
        naturalHeight,
        margin,
    )
    // 'FAST' enables Deflate compression of the embedded PNG; without it jsPDF
    // stores a near-raw bitmap and a single map screenshot balloons the file to
    // multiple MB.
    doc.addImage(dataUrl, 'PNG', x, y, width, height, undefined, 'FAST')
    return doc
}
