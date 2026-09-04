/**
 * Where the PDF viewer loads its pdf.js worker from: react-pdf v9 ships
 * pdfjs-dist v4, whose worker is an .mjs file served out of public/. Worker
 * loading needs a full URL, and resolving a document-relative path against
 * the page keeps a dashboard served under a path prefix asking its own root
 * for the file rather than the customer's domain root.
 */
export function pdfWorkerSrc(baseURI) {
    return new URL('public/workers/pdf.worker.min.mjs', baseURI).href
}
