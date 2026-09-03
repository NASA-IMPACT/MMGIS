import { test, expect } from 'vitest'
import LayerGeologic from '../../src/essence/Basics/Layers_/LayerGeologic/LayerGeologic.js'
import { pdfWorkerSrc } from '../../src/essence/Basics/Viewer_/pdfWorkerSrc.js'

// The PDF worker and LayerGeologic's patterns are public/ assets fetched by
// URL; a leading slash would send the request to the customer's domain root
// when the dashboard is served under a path prefix, so the paths must stay
// document-relative.

test.describe('public asset paths stay document-relative', () => {
    test('LayerGeologic.getUrl resolves a pattern URL under public/', () => {
        // Behavioral, not source-level: LayerGeologic.js has no JSX and
        // imports cleanly under Vitest, so exercise the real function
        // instead of pattern-matching its source.
        // Tag '101' is a real definition in patterns.json's first group.
        const url = LayerGeologic.getUrl('pattern', '101')
        expect(url.startsWith('public/')).toBe(true)
    })

    // The PDF worker URL lives in its own module so it can be exercised
    // without importing the component, which would drag react-pdf and its
    // worker setup into the test environment.
    test('the PDF worker sits under the page root', () => {
        expect(pdfWorkerSrc('https://h/')).toBe(
            'https://h/public/workers/pdf.worker.min.mjs',
        )
    })

    test('the PDF worker follows a dashboard served under a path prefix', () => {
        expect(pdfWorkerSrc('https://h/tools/dash/')).toBe(
            'https://h/tools/dash/public/workers/pdf.worker.min.mjs',
        )
    })

    test('a prefix without its trailing slash resolves a segment short', () => {
        // Relative resolution drops the last segment of a slash-less base, so
        // this URL misses the dashboard's own folder. The CloudFront Function
        // redirects a slash-less entry request to the trailing-slash form, so
        // the page's baseURI never takes this shape.
        expect(pdfWorkerSrc('https://h/tools/dash')).toBe(
            'https://h/tools/public/workers/pdf.worker.min.mjs',
        )
    })

    test('a query string on the page does not follow the PDF worker', () => {
        expect(pdfWorkerSrc('https://h/?mission=X')).toBe(
            'https://h/public/workers/pdf.worker.min.mjs',
        )
    })
})
