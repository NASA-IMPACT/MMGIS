import { test, expect, beforeEach, afterEach } from 'vitest'
import AOITool from '../../src/essence/Tools/AOI/AOITool.js'

// The AOI panel advertises "Esc to cancel" and "Press Enter to finish" without
// saying where the pointer or focus has to be, so the plugin owns both keys for
// as long as its drawing session lasts. These specs drive the session with the
// engine events the bus delivers and watch what the plugin asks the bus for.

let requests
let finishSucceeds

function press(key, target = document.body, init = {}) {
    target.dispatchEvent(
        new window.KeyboardEvent('keydown', { key, bubbles: true, ...init })
    )
}

function release(key, target = document.body) {
    target.dispatchEvent(
        new window.KeyboardEvent('keyup', { key, bubbles: true })
    )
}

function appendTo(body, tag, attributes = {}) {
    const el = document.createElement(tag)
    Object.entries(attributes).forEach(([k, v]) => el.setAttribute(k, v))
    body.appendChild(el)
    return el
}

beforeEach(() => {
    requests = []
    finishSucceeds = true
    window.mmgisAPI = {
        request: (name) => {
            requests.push(name)
            return Promise.resolve(
                name === 'map:finishDrawing' ? finishSucceeds : true
            )
        },
    }
})

afterEach(() => {
    AOITool._removeDrawKeys()
    AOITool._state.isDrawing = false
    document.body.innerHTML = ''
    delete AOITool.api
    delete window.mmgisAPI
})

test.describe('AOI draw-session keys', () => {
    test('Escape cancels the drawing from anywhere on the page', () => {
        AOITool._onDrawStart()
        press('Escape')
        expect(requests).toEqual(['map:disableDrawing'])
    })

    test('Enter finishes the drawing from anywhere on the page', () => {
        AOITool._onDrawStart()
        press('Enter')
        expect(requests).toEqual(['map:finishDrawing'])
    })

    // The map element is where terra-draw's own listeners live, and the plugin
    // has to work there too — the finish it asks for and the real keyup
    // terra-draw hears are the two halves of one press, and must not read as
    // two finishes.
    test('both keys work with the map element focused', () => {
        AOITool._onDrawStart()
        const canvas = appendTo(document.body, 'canvas')
        press('Enter', canvas)
        release('Enter', canvas)
        press('Escape', canvas)
        release('Escape', canvas)
        expect(requests).toEqual(['map:finishDrawing', 'map:disableDrawing'])
    })

    // Clicking a panel control moves focus off the map, which is exactly where
    // terra-draw stops hearing anything.
    test('both keys work with a panel control focused', () => {
        AOITool._onDrawStart()
        const button = appendTo(document.body, 'button')
        press('Enter', button)
        press('Escape', button)
        expect(requests).toEqual(['map:finishDrawing', 'map:disableDrawing'])
    })

    test('leaves the keys to whatever field they were typed in', () => {
        AOITool._onDrawStart()
        // jsdom parses contenteditable but never sets isContentEditable, so
        // stand in for the flag a browser would have raised here.
        const editable = appendTo(document.body, 'div', { contenteditable: 'true' })
        Object.defineProperty(editable, 'isContentEditable', { value: true })
        for (const target of [
            appendTo(document.body, 'input'),
            appendTo(document.body, 'textarea'),
            appendTo(document.body, 'select'),
            editable,
        ]) {
            press('Escape', target)
            press('Enter', target)
        }
        expect(requests).toEqual([])
    })

    // A dialog, menu, listbox or combobox closes on Escape itself. A drawing
    // must survive an Escape aimed at one of those — including one aimed at a
    // control nested inside it.
    test('leaves the keys to a component that closes on Escape', () => {
        AOITool._onDrawStart()
        for (const role of ['dialog', 'menu', 'listbox', 'combobox']) {
            const owner = appendTo(document.body, 'div', { role })
            const nested = appendTo(owner, 'button')
            press('Escape', owner)
            press('Escape', nested)
            press('Enter', nested)
        }
        expect(requests).toEqual([])
    })

    test('ignores a key held down long enough to repeat', () => {
        AOITool._onDrawStart()
        press('Enter', document.body, { repeat: true })
        press('Escape', document.body, { repeat: true })
        expect(requests).toEqual([])
    })

    // finishDrawing is honest about a shape it cannot commit yet, and the
    // session outlives the refusal: no drawcomplete arrives, so the plugin
    // stays in drawing state with the keys still live.
    test('keeps drawing when the shape has too few vertices to finish', async () => {
        finishSucceeds = false
        AOITool._onDrawStart()
        press('Enter')
        expect(await window.mmgisAPI.request('map:finishDrawing')).toBe(false)
        expect(AOITool._state.isDrawing).toBe(true)
        press('Enter')
        expect(requests).toEqual([
            'map:finishDrawing',
            'map:finishDrawing',
            'map:finishDrawing',
        ])
    })

    test('stops listening once the drawing completes', () => {
        AOITool._onDrawStart()
        AOITool._onDrawComplete({
            feature: {
                type: 'Feature',
                properties: { shape: 'polygon' },
                geometry: {
                    type: 'Polygon',
                    coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]],
                },
            },
        })
        requests = []
        press('Enter')
        press('Escape')
        expect(requests).toEqual([])
    })

    test('stops listening once the drawing is cancelled', () => {
        AOITool._onDrawStart()
        AOITool._onDrawCancelEvent()
        requests = []
        press('Escape')
        expect(requests).toEqual([])
    })

    test('stops listening when the tool goes away', () => {
        AOITool._onDrawStart()
        AOITool.destroy()
        requests = []
        press('Escape')
        expect(requests).toEqual([])
    })

    test('installs a single listener however often a session starts', () => {
        AOITool._onDrawStart()
        AOITool._onDrawStart()
        press('Escape')
        expect(requests).toEqual(['map:disableDrawing'])
    })

    // The keys are only ever armed by the engine's drawstart reaching the
    // plugin, so drive the session the way the bus does: through the tool the
    // panel actually makes.
    test('a drawstart delivered over the bus arms the keys', () => {
        const handlers = {}
        window.mmgisAPI.on = (event, handler) => {
            handlers[event] = handler
            return () => delete handlers[event]
        }
        // The controller injects the plugin-scoped handle before make() runs;
        // nothing here goes through it, so an inert one is enough.
        AOITool.api = {
            emit: () => { },
            provide: () => () => { },
            request: () => Promise.resolve(undefined),
        }
        appendTo(document.body, 'div', { id: 'toolPanel' })
        AOITool.make('toolPanel')

        handlers['map:drawstart']({ shape: 'polygon' })
        press('Escape')
        expect(requests).toEqual(['map:disableDrawing'])

        AOITool.destroy()
    })
})
