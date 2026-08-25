// Test stub for `src/essence/Basics/Viewer_/PDFViewer.js`.
//
// PDFViewer.js holds JSX in a `.js` file. Webpack compiles it through Babel,
// but Vite's default `.js` loader does not parse JSX, so any spec that reaches
// it transitively — anything pulling in Layers_, which imports Viewer_, which
// imports PDFViewer — dies at import analysis with a syntax error unrelated to
// what it tests. Those specs never open a PDF, so the Vitest config aliases the
// module to this stub, which offers the same shape Viewer_ calls into: a
// factory returning a viewer with `changePDF`.
export default function () {
    return {
        changePDF: (_url, _containerId, callback) => {
            if (typeof callback === 'function') callback(null)
        },
    }
}
