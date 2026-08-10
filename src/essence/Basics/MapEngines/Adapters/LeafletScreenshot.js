import jquery from 'jquery'
import html2canvas from 'html2canvas'

import {
    snapshotLeafletPaneStyles,
    applyLeafletCloneFixups,
} from './LeafletCloneFixups'

/**
 * The Leaflet map engine's screenshot strategy: rasterizes the map container
 * with html2canvas, temporarily hiding some UI (zoom controls, compass, scale
 * factor, time UI) and normalizing the Leaflet pane z-indices for the shot.
 *
 * @returns {Promise<object>} Resolves to a PNG Blob plus metadata:
 *   `{ blob, mimeType, extension, width, height }`.
 */
function getMapScreenshot() {
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

    // Snapshot now — after the z-index normalization, before the restore —
    // because onclone fires after the restore has already run.
    const paneStyles = snapshotLeafletPaneStyles({
        svgSelector: 'svg.leaflet-zoom-animated',
        tileSelector: '.leaflet-tile-pane > div.leaflet-layer',
    })

    // Split out so the error paths below can restore the hidden UI too.
    const restoreChrome = function () {
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
    }

    // The classic UI wraps the map in #mapScreen; the modern layout has no such
    // wrapper, so fall back to the #map container (present in both layouts).
    const documentElm =
        document.getElementById('mapScreen') || document.getElementById('map')
    if (!documentElm) {
        restoreChrome()
        return Promise.reject(
            new Error('getMapScreenshot: no #mapScreen/#map container to capture')
        )
    }

    let capture
    try {
        capture = html2canvas(documentElm, {
            allowTaint: true,
            useCORS: true,
            logging: false,
            scrollX: -window.scrollX,
            scrollY: -window.scrollY,
            windowWidth: documentElm.offsetWidth,
            windowHeight: documentElm.offsetHeight,
            onclone: function (e) {
                applyLeafletCloneFixups(e.body, paneStyles)
            },
        }).then(canvasToPngScreenshot)
    } catch (err) {
        restoreChrome()
        throw err
    }

    // Restore immediately (not in .then) so the UI isn't visibly degraded
    // during the capture: html2canvas clones the DOM synchronously above, and
    // the onclone fixups use the pre-restore snapshot.
    restoreChrome()

    return capture
}

function canvasToPngScreenshot(canvas) {
    return new Promise(function (resolve, reject) {
        if (typeof canvas.toBlob !== 'function') {
            reject(new Error('getMapScreenshot: canvas.toBlob is unavailable'))
            return
        }
        canvas.toBlob(function (blob) {
            if (!blob) {
                reject(new Error('getMapScreenshot: canvas.toBlob returned null'))
                return
            }
            resolve({
                blob,
                mimeType: 'image/png',
                extension: 'png',
                width: canvas.width,
                height: canvas.height,
            })
        }, 'image/png')
    })
}

export { getMapScreenshot }
