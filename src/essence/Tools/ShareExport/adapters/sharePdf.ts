// jspdf is lazy-required inside defaultFactory (never imported at module top):
// jspdf touches browser-only globals (atob/btoa) at evaluation time, so a static
// import would break Node test/SSR contexts and eagerly load a heavy module.
declare const require: (id: string) => unknown

// PDF generation is owned entirely by this plugin (core has no PDF dependency).
// The screenshot PNG is embedded centered on a portrait page, scaled to fit
// within margins while preserving its natural aspect ratio.

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

export type JsPdfFactory = () => JsPdfLike

const defaultFactory: JsPdfFactory = () => {
    const { jsPDF } = require('jspdf') as {
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
 * supplied by the caller (e.g. read from an Image element).
 */
export function buildSharePdf(
    dataUrl: string,
    naturalWidth: number,
    naturalHeight: number,
    options: BuildSharePdfOptions = {},
): JsPdfLike {
    const { margin = 36, factory = defaultFactory } = options
    const doc = factory()
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
