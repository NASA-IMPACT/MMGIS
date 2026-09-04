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
        expect(LayerGeologic.getUrl('pattern', '101')).toBe(
            'public/images/geologic/patterns/series_100.surficial/101.svg',
        )
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
})
