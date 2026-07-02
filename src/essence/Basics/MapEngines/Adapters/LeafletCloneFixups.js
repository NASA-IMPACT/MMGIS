/**
 * Shared html2canvas clone fixups for Leaflet maps, used by the screenshot
 * capture (LeafletScreenshot) and the Animation tool's offscreen frame capture
 * (OffscreenMapManager); only the scoping selectors differ.
 *
 * - Leaflet positions zoom-animated overlay SVG containers with inline CSS
 *   transforms. html2canvas can render those transformed SVGs shifted, so each
 *   SVG is re-parented into a wrapper <div> that carries the transform.
 * - Leaflet tile layers use inline z-index values on their containers. The
 *   fixup reapplies the capture-time values so screenshot ordering matches the
 *   map state at capture kickoff.
 *
 * Styles are snapshotted up front rather than read inside `onclone`, which
 * fires asynchronously — after the caller may have restored the live styles.
 */

/** Reads the inline styles the fixups need from the live document. */
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

/** Applies the fixups to an html2canvas clone (`e.body` from onclone). */
export function applyLeafletCloneFixups(cloneBody, snapshot) {
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

    const copyZ = cloneBody.querySelectorAll(snapshot.tileSelector)
    copyZ.forEach((copyEle, i) => {
        if (snapshot.tileStyles[i] != null)
            copyEle.setAttribute('style', snapshot.tileStyles[i])
    })
}
