import { test, expect } from 'vitest'

// Tests for the backend capability accessor (API/Backend/Utils/capabilities.js).
// It resolves the deployment mode once at load (via deploymentMode.js), so each
// test clears the require cache for BOTH modules and re-requires under a fresh
// env, mirroring tests/unit/deploymentMode.spec.js.

const CAPS_PATH = '../../API/Backend/Utils/capabilities.js'
const MODE_PATH = '../../API/Backend/Utils/deploymentMode.js'

function freshRequire() {
    delete require.cache[require.resolve(CAPS_PATH)]
    delete require.cache[require.resolve(MODE_PATH)]
    return require(CAPS_PATH)
}

// Capabilities that are present in full and absent in lean.
const FULL_ONLY = [
    'datasets',
    'geodatasets',
    'draw',
    'shortener',
    'localMissions',
    'localSidecars',
]

test.describe('capabilities', () => {
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
        delete require.cache[require.resolve(CAPS_PATH)]
        delete require.cache[require.resolve(MODE_PATH)]
    })

    test('in full mode, full-only capabilities are enabled and deployments is off', () => {
        process.env.MMGIS_DEPLOYMENT_MODE = 'full'
        const { enabled } = freshRequire()
        for (const cap of FULL_ONLY) {
            expect(enabled(cap), `${cap} should be enabled in full`).toBe(true)
        }
        expect(enabled('deployments')).toBe(false)
    })

    test('defaults (unset env) behave as full', () => {
        const { enabled } = freshRequire()
        for (const cap of FULL_ONLY) {
            expect(enabled(cap), `${cap} should be enabled by default`).toBe(
                true
            )
        }
        expect(enabled('deployments')).toBe(false)
    })

    test('in lean mode, full-only capabilities are disabled and deployments is on', () => {
        process.env.MMGIS_DEPLOYMENT_MODE = 'lean'
        const { enabled } = freshRequire()
        for (const cap of FULL_ONLY) {
            expect(enabled(cap), `${cap} should be disabled in lean`).toBe(false)
        }
        expect(enabled('deployments')).toBe(true)
    })

    test('throws on an unknown capability (backend contract: fail at boot)', () => {
        process.env.MMGIS_DEPLOYMENT_MODE = 'full'
        const { enabled } = freshRequire()
        expect(() => enabled('notACapability')).toThrow(
            /Unknown capability: 'notACapability'/
        )
    })

    test('localSidecars and localMissions are distinct capabilities', () => {
        // Same on/off today, but they must be queryable independently so they
        // can diverge without a rewrite.
        process.env.MMGIS_DEPLOYMENT_MODE = 'lean'
        const { enabled } = freshRequire()
        expect(enabled('localSidecars')).toBe(false)
        expect(enabled('localMissions')).toBe(false)
    })
})
