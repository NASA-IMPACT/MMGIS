import { test, expect } from 'vitest'

import getMapScreenshot, {
    getMapScreenshot as namedGetMapScreenshot,
} from '../../src/essence/Basics/MapEngines/Adapters/LeafletScreenshot.js'

// Issue #143 - expose share-link and map-screenshot as first-class plugin API.
//
// LeafletScreenshot.getMapScreenshot() drives the live DOM (jQuery) and rasterizes
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
            // A matched selector reports one element; the code uses .length to
            // detect whether the time UI was active before the capture.
            length: 1,
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

function makePngBlob(content = 'png') {
    return new Blob([content], { type: 'image/png' })
}

function makeMockHtml2canvas(blob = makePngBlob()) {
    const calls = [] // { element, options }
    function html2canvas(element, options) {
        calls.push({ element, options })
        return Promise.resolve({
            width: element.offsetWidth,
            height: element.offsetHeight,
            toBlob: (callback, type) => {
                expect(type).toBe('image/png')
                callback(blob)
            },
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

test.describe('LeafletScreenshot.getMapScreenshot - export surface', () => {
    test('is exported as both a default and named function', () => {
        expect(typeof getMapScreenshot).toBe('function')
        expect(typeof namedGetMapScreenshot).toBe('function')
        expect(getMapScreenshot).toBe(namedGetMapScreenshot)
    })
})

test.describe('LeafletScreenshot.getMapScreenshot - behavior', () => {
    test.beforeEach(() => {
        setupGlobalDom()
    })

    test('resolves to a PNG Blob screenshot result produced by html2canvas', async () => {
        const jquery = makeMockJQuery('5px')
        const blob = makePngBlob('leaflet')
        const html2canvas = makeMockHtml2canvas(blob)

        const result = await getMapScreenshot({ jquery, html2canvas })

        expect(result).toEqual({
            blob,
            mimeType: 'image/png',
            extension: 'png',
            width: 1024,
            height: 768,
        })
    })

    test('rejects when canvas.toBlob returns null', async () => {
        const jquery = makeMockJQuery('5px')
        const html2canvas = makeMockHtml2canvas()
        html2canvas._calls = []
        const nullBlobHtml2canvas = (element, options) => {
            html2canvas._calls.push({ element, options })
            return Promise.resolve({
                width: element.offsetWidth,
                height: element.offsetHeight,
                toBlob: (callback) => callback(null),
            })
        }

        await expect(
            getMapScreenshot({ jquery, html2canvas: nullBlobHtml2canvas })
        ).rejects.toThrow(/toBlob returned null/)
    })

    test('invokes html2canvas once on #mapScreen with an onclone option', async () => {
        const jquery = makeMockJQuery('5px')
        const html2canvas = makeMockHtml2canvas()

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
        const html2canvas = makeMockHtml2canvas()

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
        const html2canvas = makeMockHtml2canvas()

        await getMapScreenshot({ jquery, html2canvas })

        const bottomValues = jquery._cssSets
            .filter((c) => c.selector === '#mapToolBar' && c.prop === 'bottom')
            .map((c) => c.value)

        expect(bottomValues).toEqual(['0px', '5px'])
        expect(bottomValues).not.toContain('savedMapToolBarBottom')
    })

    test('collapses the time UI for the capture and reopens it afterwards', async () => {
        // Regression guard: the time UI is toggled off (via the .active
        // selector) before the shot and must be toggled back on (via the plain
        // selector, since the click cleared .active) afterwards. Previously the
        // restore was missing, leaving the time UI collapsed.
        const jquery = makeMockJQuery('5px')
        const html2canvas = makeMockHtml2canvas()

        await getMapScreenshot({ jquery, html2canvas })

        const timeToggleEvents = jquery._triggered.filter((t) =>
            t.selector.startsWith('#toggleTimeUI')
        )
        expect(timeToggleEvents).toEqual([
            { selector: '#toggleTimeUI.active', event: 'click' },
            { selector: '#toggleTimeUI', event: 'click' },
        ])
    })
})
