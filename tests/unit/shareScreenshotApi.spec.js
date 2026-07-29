import { test, expect, vi } from 'vitest'

// Issue #143 - expose share-link and map-screenshot as first-class plugin API.
//
// LeafletScreenshot.getMapScreenshot() drives the live DOM (jQuery) and
// rasterizes with html2canvas, neither of which exists in this Node test
// context — so both module imports are replaced with configurable fakes via
// vi.mock (no production injection seam needed). Each test assigns the fake
// implementations through the hoisted `mocks` holder before calling.

const mocks = vi.hoisted(() => ({ jquery: null, html2canvas: null }))
vi.mock('jquery', () => ({ default: (...args) => mocks.jquery(...args) }))
vi.mock('html2canvas', () => ({
    default: (...args) => mocks.html2canvas(...args),
}))

import { getMapScreenshot } from '../../src/essence/Basics/MapEngines/Adapters/LeafletScreenshot.js'

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

test.describe('LeafletScreenshot.getMapScreenshot - behavior', () => {
    test.beforeEach(() => {
        setupGlobalDom()
        mocks.jquery = makeMockJQuery('5px')
        mocks.html2canvas = makeMockHtml2canvas()
    })

    test('resolves to a PNG Blob screenshot result produced by html2canvas', async () => {
        const blob = makePngBlob('leaflet')
        mocks.html2canvas = makeMockHtml2canvas(blob)

        const result = await getMapScreenshot()

        expect(result).toEqual({
            blob,
            mimeType: 'image/png',
            extension: 'png',
            width: 1024,
            height: 768,
        })
    })

    test('rejects when canvas.toBlob returns null', async () => {
        mocks.html2canvas = (element, options) =>
            Promise.resolve({
                width: element.offsetWidth,
                height: element.offsetHeight,
                toBlob: (callback) => callback(null),
            })

        await expect(getMapScreenshot()).rejects.toThrow(/toBlob returned null/)
    })

    test('invokes html2canvas once on #mapScreen with an onclone option', async () => {
        const html2canvas = mocks.html2canvas

        await getMapScreenshot()

        expect(html2canvas._calls.length).toBe(1)
        const { element, options } = html2canvas._calls[0]
        expect(element.offsetWidth).toBe(1024)
        expect(options.windowWidth).toBe(1024)
        expect(options.windowHeight).toBe(768)
        // The onclone SVG/z-index fixups are mandatory for a correct capture.
        expect(typeof options.onclone).toBe('function')
    })

    test('hides UI chrome for the capture and restores it afterwards', async () => {
        const jquery = mocks.jquery

        await getMapScreenshot()

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
        const jquery = mocks.jquery

        await getMapScreenshot()

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
        const jquery = mocks.jquery

        await getMapScreenshot()

        const timeToggleEvents = jquery._triggered.filter((t) =>
            t.selector.startsWith('#toggleTimeUI')
        )
        expect(timeToggleEvents).toEqual([
            { selector: '#toggleTimeUI.active', event: 'click' },
            { selector: '#toggleTimeUI', event: 'click' },
        ])
    })

    test('onclone applies the styles snapshotted before the UI restore', async () => {
        // Regression guard for the restore/onclone race: the clone fixups must
        // use the tile styles captured at kickoff (post-normalization), not
        // re-read the live DOM (already restored when onclone fires). We
        // simulate: live tiles report style A at kickoff, then mutate to style
        // B before onclone runs — the clone must receive A.
        const liveTile = {
            getAttribute: () => 'z-index: 1',
            setAttribute() {},
        }
        global.document.body.querySelectorAll = (sel) =>
            sel.includes('tile') ? [liveTile] : []

        let cloneApplied = []
        const cloneTile = {
            setAttribute: (name, value) => cloneApplied.push(value),
            getAttribute: () => null,
        }
        mocks.html2canvas = (element, options) => {
            // Live DOM "restores" (mutates) before onclone fires.
            liveTile.getAttribute = () => 'z-index: 999'
            options.onclone({
                body: {
                    querySelectorAll: (sel) =>
                        sel.includes('tile') ? [cloneTile] : [],
                },
            })
            return Promise.resolve({
                width: element.offsetWidth,
                height: element.offsetHeight,
                toBlob: (callback) => callback(makePngBlob()),
            })
        }

        await getMapScreenshot()

        expect(cloneApplied).toEqual(['z-index: 1'])
    })
})
