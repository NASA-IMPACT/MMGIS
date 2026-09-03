/**
 * Where the PDF viewer loads its pdf.js worker from.
 *
 * react-pdf v9 ships pdfjs-dist v4, whose worker is an .mjs file served out of
 * public/. Worker loading needs a full URL — a bare relative string would
 * resolve against the script's own URL rather than the page — and the path
 * stays document-relative so a dashboard served under a path prefix asks its
 * own root for the file instead of the customer's domain root.
 */
export function pdfWorkerSrc(baseURI) {
    return new URL('public/workers/pdf.worker.min.mjs', baseURI).href
}
