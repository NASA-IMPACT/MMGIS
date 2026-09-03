import { test, expect, vi, beforeEach } from 'vitest'

// The landing page hands a chosen mission to the app, so everything on the
// far side of that hand-off is stubbed. What is under test is only which URL
// flags make it show the mission list instead of jumping straight into the
// one mission on offer.
vi.mock('../../src/essence/essence', () => ({ default: { init: vi.fn() } }))
vi.mock('../../src/essence/modern', () => ({ default: { init: vi.fn() } }))
vi.mock('../../src/essence/mmgisAPI/mmgisAPI', () => ({ mmgisAPI_: {} }))
vi.mock('../../src/external/attributions', () => ({ default: [] }))
vi.mock('../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))
// The config fetch answers with a classic-mode config, so a straight-through
// load reaches essence.init.
vi.mock('../../src/pre/calls', () => ({
    default: {
        api: vi.fn((verb, params, onSuccess) =>
            onSuccess({ msv: { mission: 'OnlyMission' } })
        ),
    },
}))
vi.mock('../../src/pre/capabilities', () => ({
    isStaticBuild: vi.fn(() => false),
}))

import LandingPage from '../../src/essence/LandingPage/LandingPage'
import { isStaticBuild } from '../../src/pre/capabilities'
import s from '../../src/essence/essence'

const MISSIONS = ['OnlyMission']

const initAt = (query) => {
    window.history.replaceState({}, '', '/?' + query)
    LandingPage.init(MISSIONS, false, false)
}

beforeEach(() => {
    document.body.innerHTML = ''
    window.mmgisglobal = { version: '0.0.0', MAIN_MISSION: '' }
    vi.clearAllMocks()
    isStaticBuild.mockReturnValue(false)
})

test('a lone mission loads straight through when the flag is absent', () => {
    initAt('')
    expect(document.querySelector('.landingPage')).toBeNull()
    expect(s.init).toHaveBeenCalled()
})

// Which spellings of the flag count is landingFlags' business, and its own
// table in tests/unit/landingFlags.spec.js walks them. What the landing page
// owns is the response: a recognized flag holds the mission list up instead
// of auto-loading the lone mission.
test('?forcelanding holds the mission list up', () => {
    initAt('forcelanding')
    expect(document.querySelector('.landingPage')).not.toBeNull()
})

test('a static build strips both spellings from its URL', () => {
    // A static dashboard only ever shows its baked mission, so the flag is
    // both ignored and cleared out of the address bar.
    isStaticBuild.mockReturnValue(true)
    window.mmgisglobal = { version: '0.0.0', MAIN_MISSION: 'M' }

    initAt('forcelanding&forceLanding=1&keep=me')

    expect(window.location.search).toBe('?keep=me')
})
