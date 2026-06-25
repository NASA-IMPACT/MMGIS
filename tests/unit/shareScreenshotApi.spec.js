import { test, expect } from '@playwright/test'

import getMapScreenshot, {
    getMapScreenshot as namedGetMapScreenshot,
} from '../../src/essence/Basics/UserInterface_/ScreenshotUtils.js'

// Issue #143 - expose share-link and map-screenshot as first-class plugin API.
//
// ScreenshotUtils.getMapScreenshot() drives the live DOM (jQuery) and rasterizes
// with html2canvas, neither of which exists in this Node test context. The
// function therefore accepts injectable `jquery`/`html2canvas` deps so the
// behavior can be exercised against lightweight fakes.

// A fake jQuery that records every .css(prop, value) setter call (keyed by the
// selector it was invoked on) and answers .css(prop) getters with a known value.
function makeMockJQuery(getterValue) {
    const cssSets = [] // { selector, prop, value }
    const triggered = [] // { selector, event }

    function makeNode(selector) {
        return {
            css(prop, value) {
                if (value === undefined) return getterValue // getter
                cssSets.push({ selector, prop, value })
                return this
            },
            children() {
                // No children in the fake DOM; the z-index reorder loop no-ops.
                return { each() { return this } }
            },
            trigger(event) {
                triggered.push({ selector, event })
                return this
            },
        }
    }

    function jquery(selector) {
        return makeNode(selector)
    }
    jquery._cssSets = cssSets
    jquery._triggered = triggered
    return jquery
}

function makeMockHtml2canvas(dataURL) {
    const calls = [] // { element, options }
    function html2canvas(element, options) {
        calls.push({ element, options })
        return Promise.resolve({
            toDataURL: () => dataURL,
        })
    }
    html2canvas._calls = calls
    return html2canvas
}

function setupGlobalDom() {
    global.window = global.window || {}
    global.window.scrollX = 0
    global.window.scrollY = 0
    global.document = {
        getElementById: (id) =>
            id === 'mapScreen' ? { offsetWidth: 1024, offsetHeight: 768 } : null,
        body: { querySelectorAll: () => [] },
        createElement: () => ({
            appendChild() {},
            removeChild() {},
            setAttribute() {},
            removeAttribute() {},
        }),
    }
}

test.describe('ScreenshotUtils.getMapScreenshot - export surface', () => {
    test('is exported as both a default and named function', () => {
        expect(typeof getMapScreenshot).toBe('function')
        expect(typeof namedGetMapScreenshot).toBe('function')
        expect(getMapScreenshot).toBe(namedGetMapScreenshot)
    })
})

test.describe('ScreenshotUtils.getMapScreenshot - behavior', () => {
    test.beforeEach(() => {
        setupGlobalDom()
    })

    test('resolves to the PNG data URL produced by html2canvas', async () => {
        const jquery = makeMockJQuery('5px')
        const html2canvas = makeMockHtml2canvas('data:image/png;base64,FAKEPNG')

        const result = await getMapScreenshot({ jquery, html2canvas })

        expect(result).toBe('data:image/png;base64,FAKEPNG')
    })

    test('invokes html2canvas once on #mapScreen with an onclone option', async () => {
        const jquery = makeMockJQuery('5px')
        const html2canvas = makeMockHtml2canvas('data:image/png;base64,X')

        await getMapScreenshot({ jquery, html2canvas })

        expect(html2canvas._calls.length).toBe(1)
        const { element, options } = html2canvas._calls[0]
        expect(element.offsetWidth).toBe(1024)
        expect(options.windowWidth).toBe(1024)
        expect(options.windowHeight).toBe(768)
        // The onclone SVG/z-index fixups are mandatory for a correct capture.
        expect(typeof options.onclone).toBe('function')
    })

    test('hides UI chrome for the capture and restores it afterwards', async () => {
        const jquery = makeMockJQuery('5px')
        const html2canvas = makeMockHtml2canvas('data:image/png;base64,X')

        await getMapScreenshot({ jquery, html2canvas })

        const displayFor = (selector) =>
            jquery._cssSets
                .filter((c) => c.selector === selector && c.prop === 'display')
                .map((c) => c.value)

        // Each chrome element is hidden, then restored (visible) again.
        expect(displayFor('.leaflet-control-zoom')).toEqual(['none', 'block'])
        expect(displayFor('.leaflet-control-scalefactor')).toEqual([
            'none',
            'flex',
        ])
        expect(displayFor('#mmgis-map-compass')).toEqual(['none', 'block'])
    })

    test('restores #mapToolBar bottom to its saved value, not a string literal', async () => {
        // Regression guard: the restore must pass the captured variable, not the
        // literal 'savedMapToolBarBottom'. Saved value here is '5px'.
        const jquery = makeMockJQuery('5px')
        const html2canvas = makeMockHtml2canvas('data:image/png;base64,X')

        await getMapScreenshot({ jquery, html2canvas })

        const bottomValues = jquery._cssSets
            .filter((c) => c.selector === '#mapToolBar' && c.prop === 'bottom')
            .map((c) => c.value)

        expect(bottomValues).toEqual(['0px', '5px'])
        expect(bottomValues).not.toContain('savedMapToolBarBottom')
    })
})
