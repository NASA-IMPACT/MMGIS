/**
 * Shared html2canvas clone fixups for Leaflet maps.
 *
 * html2canvas clones the DOM and rasterizes the clone, but two Leaflet quirks
 * make a naive clone render wrong:
 *  - Overlay SVGs carry Leaflet's pan/zoom transform in their inline style,
 *    and html2canvas mispositions transformed SVGs — so each SVG is
 *    re-parented into a wrapper <div> that carries the transform instead.
 *  - Tile layers stack by inline z-index, which the clone can lose.
 *
 * Both the screenshot capture (LeafletScreenshot) and the Animation tool's
 * offscreen frame capture (OffscreenMapManager) need the identical fixups;
 * they differ only in the selectors that scope which map is being captured.
 *
 * The styles are snapshotted from the live document up front (not read inside
 * `onclone`): html2canvas fires `onclone` asynchronously, so by then the
 * caller may have restored/mutated the live styles — the snapshot pins the
 * capture to the styles exactly as they were at kickoff.
 */

/**
 * Reads the inline style attributes the clone fixups will need, from the live
 * document, at call time. Call this at capture kickoff, before any UI restore.
 *
 * @param {object} selectors
 * @param {string} selectors.svgSelector - matches the map's overlay SVGs
 * @param {string} selectors.tileSelector - matches the map's tile layer divs
 * @returns {object} snapshot to pass to {@link applyLeafletCloneFixups}
 */
export function snapshotLeafletPaneStyles({ svgSelector, tileSelector }) {
    return {
        svgSelector,
        tileSelector,
        svgStyles: Array.from(
            document.body.querySelectorAll(svgSelector),
            (el) => el.getAttribute('style')
        ),
        tileStyles: Array.from(
            document.body.querySelectorAll(tileSelector),
            (el) => el.getAttribute('style')
        ),
    }
}

/**
 * Applies the fixups to an html2canvas clone (the `onclone` callback's body).
 *
 * @param {HTMLElement} cloneBody - `e.body` from html2canvas's onclone
 * @param {object} snapshot - from {@link snapshotLeafletPaneStyles}
 */
export function applyLeafletCloneFixups(cloneBody, snapshot) {
    // Fix svg layer shift: move each overlay SVG's inline style (Leaflet's
    // pan/zoom transform) onto a wrapper div, which html2canvas renders
    // correctly.
    const copySVG = cloneBody.querySelectorAll(snapshot.svgSelector)
    copySVG.forEach((copyEle, i) => {
        const attribute = snapshot.svgStyles[i]
        const parentElement = copyEle.parentElement
        parentElement.removeChild(copyEle)
        const temp = document.createElement('div')
        temp.appendChild(copyEle)
        parentElement.appendChild(temp)
        if (attribute != null) temp.setAttribute('style', attribute)
        copyEle.removeAttribute('style')
    })

    // Fix tile layer stacking: copy the snapshotted inline styles (z-index)
    // onto the clone's tile layers.
    const copyZ = cloneBody.querySelectorAll(snapshot.tileSelector)
    copyZ.forEach((copyEle, i) => {
        if (snapshot.tileStyles[i] != null)
            copyEle.setAttribute('style', snapshot.tileStyles[i])
    })
}
