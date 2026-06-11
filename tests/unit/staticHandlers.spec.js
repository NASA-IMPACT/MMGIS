import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'

// Parity check between the calls.js registry and the static dispatcher:
// every named call must have a STATIC_HANDLERS handler, and the table must
// not carry stale entries. Sources are compared by regex extraction because
// staticHandlers.js imports through the STATIC_MISSION_CONFIG webpack alias,
// which does not resolve under Playwright's Node transform.

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
