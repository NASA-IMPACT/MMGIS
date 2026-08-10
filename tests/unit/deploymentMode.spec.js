import { test, expect } from 'vitest'

// Tests for the MMGIS_DEPLOYMENT_MODE backend helper.
// The module resolves the mode once at load, so each test clears the
// require cache and re-requires it under a fresh environment.

const HELPER_PATH = '../../API/Backend/Utils/deploymentMode.js'

function freshRequire() {
    delete require.cache[require.resolve(HELPER_PATH)]
    return require(HELPER_PATH)
}

test.describe('deploymentMode', () => {
    let savedMode

    test.beforeEach(() => {
        savedMode = process.env.MMGIS_DEPLOYMENT_MODE
        delete process.env.MMGIS_DEPLOYMENT_MODE
    })

    test.afterEach(() => {
        if (savedMode === undefined) {
            delete process.env.MMGIS_DEPLOYMENT_MODE
        } else {
            process.env.MMGIS_DEPLOYMENT_MODE = savedMode
        }
        delete require.cache[require.resolve(HELPER_PATH)]
    })

    test('defaults to full when MMGIS_DEPLOYMENT_MODE is unset', () => {
        const { MODE } = freshRequire()
        expect(MODE).toBe('full')
    })

    test('resolves full when MMGIS_DEPLOYMENT_MODE=full', () => {
        process.env.MMGIS_DEPLOYMENT_MODE = 'full'
        const { MODE } = freshRequire()
        expect(MODE).toBe('full')
    })

    test('resolves lean when MMGIS_DEPLOYMENT_MODE=lean', () => {
        process.env.MMGIS_DEPLOYMENT_MODE = 'lean'
        const { MODE } = freshRequire()
        expect(MODE).toBe('lean')
    })

    test('throws at load on an unknown mode', () => {
        process.env.MMGIS_DEPLOYMENT_MODE = 'bogus'
        expect(() => freshRequire()).toThrow(
            /Invalid MMGIS_DEPLOYMENT_MODE: 'bogus'/
        )
    })

    test('treats an empty string as unset and defaults to full', () => {
        process.env.MMGIS_DEPLOYMENT_MODE = ''
        const { MODE } = freshRequire()
        expect(MODE).toBe('full')
    })

    test('is case-sensitive and throws on LEAN', () => {
        process.env.MMGIS_DEPLOYMENT_MODE = 'LEAN'
        expect(() => freshRequire()).toThrow(
            /Invalid MMGIS_DEPLOYMENT_MODE: 'LEAN'/
        )
    })

    test('resolves the mode once at load; later env changes are ignored', () => {
        process.env.MMGIS_DEPLOYMENT_MODE = 'lean'
        const helper = freshRequire()
        process.env.MMGIS_DEPLOYMENT_MODE = 'full'
        expect(helper.MODE).toBe('lean')
    })
})
