import { test, expect, afterEach, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import STATIC_HANDLERS from '../../src/pre/staticHandlers.js'

// Parity check between the calls.js registry and the static dispatcher:
// every named call must have a STATIC_HANDLERS handler, and the table must
// not carry stale entries. Sources are compared by regex extraction so the
// check does not depend on calls.js being importable outside webpack.

const readSource = (relativePath) =>
    fs.readFileSync(path.resolve(process.cwd(), relativePath), 'utf8')

const getCallNames = () => {
    const source = readSource('src/pre/calls.js')
    const registry = source.match(/const c = \{[\s\S]*?\n\}/)[0]
    return [...registry.matchAll(/^    ([A-Za-z0-9_]+): \{$/gm)].map(
        (m) => m[1]
    )
}

const getHandlerNames = () => {
    const source = readSource('src/pre/staticHandlers.js')
    const table = source.match(/const STATIC_HANDLERS = \{[\s\S]*?\n\}/)[0]
    return [...table.matchAll(/^    ([A-Za-z0-9_]+):/gm)].map((m) => m[1])
}

test.describe('staticHandlers parity with calls.js', () => {
    test('calls.js registry has the expected 40 entries', () => {
        expect(getCallNames()).toHaveLength(40)
    })

    test('every calls.js entry has a STATIC_HANDLERS handler', () => {
        const callNames = getCallNames()
        const handlerNames = new Set(getHandlerNames())
        const missing = callNames.filter((name) => !handlerNames.has(name))
        expect(missing).toEqual([])
    })

    test('STATIC_HANDLERS has no entries missing from calls.js', () => {
        const callNames = new Set(getCallNames())
        const handlerNames = getHandlerNames()
        const stale = handlerNames.filter((name) => !callNames.has(name))
        expect(stale).toEqual([])
    })
})

// Baked answers come from mmgisglobal.STATIC_CONFIG, which the inline script
// in index.html parses out of the #mmgis-static-config block the publish
// task fills (scripts/lib/static-index.js).
test.describe('staticHandlers read the published static config', () => {
    afterEach(() => {
        delete window.mmgisglobal
        vi.restoreAllMocks()
    })

    const call = (name) => {
        const success = vi.fn()
        const error = vi.fn()
        STATIC_HANDLERS[name]({}, success, error)
        return { success, error }
    }

    test('missions and get_generaloptions answer from STATIC_CONFIG', () => {
        const missions = { status: 'success', missions: ['Jezero'] }
        const options = { status: 'success', options: { a: 1 } }
        window.mmgisglobal = {
            SERVER: 'static',
            STATIC_CONFIG: { missions, get_generaloptions: options },
        }
        const m = call('missions')
        expect(m.success).toHaveBeenCalledWith(missions)
        expect(m.error).not.toHaveBeenCalled()
        const o = call('get_generaloptions')
        expect(o.success).toHaveBeenCalledWith(options)
    })

    test('a missing baked answer warns and takes the error path', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        window.mmgisglobal = { SERVER: 'static', STATIC_CONFIG: {} }
        const m = call('missions')
        expect(m.success).not.toHaveBeenCalled()
        expect(m.error).toHaveBeenCalled()
        expect(warn).toHaveBeenCalled()
    })

    test('no STATIC_CONFIG at all takes the error path', () => {
        vi.spyOn(console, 'warn').mockImplementation(() => {})
        window.mmgisglobal = { SERVER: 'static' }
        expect(call('get_generaloptions').error).toHaveBeenCalled()
    })

    test('get is a drop: static builds load config.json instead', () => {
        window.mmgisglobal = {
            SERVER: 'static',
            STATIC_CONFIG: { get: { msv: {} } },
        }
        const g = call('get')
        expect(g.success).not.toHaveBeenCalled()
        expect(g.error).toHaveBeenCalled()
    })
})
