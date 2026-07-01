import $ from 'jquery'
import HTML2Canvas from 'html2canvas'

/**
 * The Leaflet map engine's screenshot strategy: captures a PNG of the current
 * 2D Leaflet map. Invoked via `LeafletAdapter.captureScreenshot()`, which is
 * what `mmgisAPI.getMapScreenshot()` delegates to when Leaflet is the active
 * engine. (The deck.gl engine reads its WebGL canvas instead — see
 * `DeckGLAdapter.captureScreenshot()`.)
 *
 * Temporarily hides UI chrome (zoom controls, compass, scale factor, time UI)
 * and normalizes the Leaflet pane z-indices so html2canvas rasterizes the
 * layers in the correct order, then restores that chrome afterwards. The
 * `onclone` callback performs non-obvious SVG re-parenting and tile-pane
 * z-index fixups that the cloned document needs in order to render identically
 * to the live map; it must not be altered.
 *
 * @param {object} [deps] - Injectable dependencies (intended for testing). In
 *   production these default to the imported jQuery and html2canvas.
 * @param {function} [deps.html2canvas] - html2canvas implementation.
 * @param {function} [deps.jquery] - jQuery implementation.
 * @returns {Promise<string>} Resolves to a PNG image as a data URL string
 *   (e.g. 'data:image/png;base64,...'). The data URL form is convenient for
 *   both triggering a download and embedding the image (e.g. into a PDF).
 */
function getMapScreenshot(deps = {}) {
    const html2canvas = deps.html2canvas || HTML2Canvas
    const jquery = deps.jquery || $

    //We need to manually order leaflet z-indices for this to work
    let zIndices = []
    jquery('#map .leaflet-tile-pane')
        .children()
        .each(function (i, elm) {
            zIndices.push(jquery(elm).css('z-index'))
            jquery(elm).css('z-index', i + 1)
        })
    jquery('.leaflet-control-scalefactor').css('display', 'none')
    jquery('#mmgis-map-compass').css('display', 'none')
    jquery('.leaflet-control-zoom').css('display', 'none')
    jquery('#scaleBar').css('margin-top', '0px')
    const savedMapToolBarBottom = jquery('#mapToolBar').css('bottom') || '0px'
    jquery('#mapToolBar').css('bottom', '0px')
    // Collapse the time UI so it stays out of the capture; remember whether it
    // was open so we can restore it afterwards (the click removes the .active
    // class, so the restore re-triggers the plain #toggleTimeUI selector).
    const timeUIWasActive = jquery('#toggleTimeUI.active').length > 0
    if (timeUIWasActive) jquery('#toggleTimeUI.active').trigger('click')

    // The classic UI wraps the map in #mapScreen; the modern layout has no such
    // wrapper, so fall back to the #map container (present in both layouts).
    const documentElm =
        document.getElementById('mapScreen') || document.getElementById('map')
    const capture = html2canvas(documentElm, {
        allowTaint: true,
        useCORS: true,
        logging: false,
        scrollX: -window.scrollX,
        scrollY: -window.scrollY,
        windowWidth: documentElm.offsetWidth,
        windowHeight: documentElm.offsetHeight,
        onclone: function (e) {
            // Fix svg layer shift
            const originalSVG = document.body.querySelectorAll(
                'svg.leaflet-zoom-animated'
            )
            const copySVG = e.body.querySelectorAll(
                'svg.leaflet-zoom-animated'
            )
            copySVG.forEach((copyEle, i) => {
                const attribute = originalSVG
                    .item(i)
                    .getAttribute('style')
                const parentElement = copyEle.parentElement
                parentElement.removeChild(copyEle)
                const temp = document.createElement('div')
                temp.appendChild(copyEle)
                parentElement.appendChild(temp)
                temp.setAttribute('style', attribute)
                copyEle.removeAttribute('style')
            })

            // Fix tile layer z-indices
            const originalZ = document.body.querySelectorAll(
                '.leaflet-tile-pane > div.leaflet-layer'
            )
            const copyZ = e.body.querySelectorAll(
                '.leaflet-tile-pane > div.leaflet-layer'
            )
            copyZ.forEach((copyEle, i) => {
                const attribute = originalZ
                    .item(i)
                    .getAttribute('style')
                copyEle.setAttribute('style', attribute)
            })
        },
    }).then(function (canvas) {
        return canvas.toDataURL('image/png')
    })

    // Restore the UI chrome we hid for the capture. This runs immediately
    // (not in .then) because html2canvas clones the DOM synchronously within
    // the call above, before its first internal await, so the capture already
    // holds the hidden-chrome state and restoring the live UI now does not
    // affect it.
    jquery('#map .leaflet-tile-pane')
        .children()
        .each(function (i, elm) {
            jquery(elm).css('z-index', zIndices[i])
        })
    jquery('.leaflet-control-scalefactor').css('display', 'flex')
    jquery('#mmgis-map-compass').css('display', 'block')
    jquery('.leaflet-control-zoom').css('display', 'block')
    jquery('#scaleBar').css('margin-top', '5px')
    jquery('#mapToolBar').css('bottom', savedMapToolBarBottom)
    if (timeUIWasActive) jquery('#toggleTimeUI').trigger('click')

    return capture
}

export { getMapScreenshot }
export default getMapScreenshot
