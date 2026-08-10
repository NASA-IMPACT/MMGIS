import { test, expect, beforeEach, afterEach } from 'vitest'
import { isCapabilityEnabled } from '../../configure/src/core/capabilities'

// Backend capabilities.js (API/Backend/Utils/capabilities.js) and the Configure
// twin (configure/src/core/capabilities.js) hand-maintain two overlapping
// capability -> enabling-mode(s) maps. Nothing structurally forces them to
// agree, so this guards against silent drift: for every capability the two
// share, and in every mode, the backend's enabled(cap) must equal the twin's
// isCapabilityEnabled(cap).
//
// Compared at the BEHAVIOR level (the two accessors), not by reaching into
// either map's internals. The backend resolves MODE once at load (via
// deploymentMode.js), so it's re-required under a fresh env per mode, mirroring
// capabilities.spec.js; the twin reads window.mmgisglobal.DEPLOYMENT_MODE live
// on each call, so it just needs the global set.

const CAPS_PATH = '../../API/Backend/Utils/capabilities.js'
const MODE_PATH = '../../API/Backend/Utils/deploymentMode.js'

// The backend ∩ twin capability intersection. Capabilities that exist only on
// one side (e.g. backend-only draw/shortener/localMissions/s3AssetUploads) have
// nothing to agree with and are intentionally excluded.
const SHARED = ['localSidecars', 'datasets', 'geodatasets', 'deployments']
const MODES = ['full', 'lean']

function backendFor(mode) {
    process.env.MMGIS_DEPLOYMENT_MODE = mode
    delete require.cache[require.resolve(MODE_PATH)]
    delete require.cache[require.resolve(CAPS_PATH)]
    return require(CAPS_PATH).enabled
}

test.describe('capabilities backend/Configure twin agreement', () => {
    let savedMode

    beforeEach(() => {
        savedMode = process.env.MMGIS_DEPLOYMENT_MODE
    })

    afterEach(() => {
        if (savedMode === undefined) delete process.env.MMGIS_DEPLOYMENT_MODE
        else process.env.MMGIS_DEPLOYMENT_MODE = savedMode
        delete require.cache[require.resolve(MODE_PATH)]
        delete require.cache[require.resolve(CAPS_PATH)]
        delete window.mmgisglobal
    })

    for (const mode of MODES) {
        test(`shared capabilities agree in ${mode}`, () => {
            const enabled = backendFor(mode)
            window.mmgisglobal = { DEPLOYMENT_MODE: mode }

            for (const cap of SHARED) {
                expect(
                    isCapabilityEnabled(cap),
                    `twin and backend disagree on "${cap}" in ${mode}`
                ).toBe(enabled(cap))
            }
        })
    }
})
