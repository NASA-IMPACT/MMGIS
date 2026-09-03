import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import LayerGeologic from '../../src/essence/Basics/Layers_/LayerGeologic/LayerGeologic.js'

// PDFViewer.jsx and LayerGeologic.js fetch public/ assets by URL; a leading
// slash would send the request to the customer's domain root when the
// dashboard is served under a path prefix, so the paths must stay
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

    test('PDFViewer.jsx does not root its worker path', () => {
        // A source tripwire, not a behavioral import: importing the component
        // would drag react-pdf and its worker setup into the test environment.
        const source = fs.readFileSync(
            path.join(__dirname, '../../src/essence/Basics/Viewer_/PDFViewer.jsx'),
            'utf8',
        )
        expect(source).not.toMatch(/['"`]\/public/)
    })
})
