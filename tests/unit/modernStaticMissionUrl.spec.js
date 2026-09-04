import { test, expect, vi, beforeEach } from 'vitest'

// The wiring between the modern interface and nameMissionInUrl: the mission
// the config names and the swap flag both reach it, and the build
// personality is honoured. Which entry URLs get rewritten is
// nameMissionInUrl's own business, walked in tests/unit/landingFlags.spec.js.
//
// Everything modern.js pulls in at load time is a browser-coupled singleton
// it does not need for this, so the lot is stubbed; only the URL the method
// leaves behind is under test.
vi.mock('../../src/essence/Basics/PanelManager_/PanelManager_', () => ({
    default: {},
}))
vi.mock(
    '../../src/essence/Basics/UserInterface_/UserInterfaceModern_',
    () => ({ default: {} })
)
vi.mock(
    '../../src/essence/Basics/ToolController_/ToolControllerModern_',
    () => ({ default: {} })
)
vi.mock(
    '../../src/essence/Basics/ComponentController_/ComponentController_',
    () => ({ default: {} })
)
vi.mock('../../src/essence/Basics/Formulae_/Formulae_', () => ({
    default: {},
}))
vi.mock('../../src/essence/Basics/Layers_/Layers_', () => ({ default: {} }))
vi.mock('../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))
vi.mock('../../src/essence/Basics/Map_/Map_', () => ({ default: {} }))
vi.mock('../../src/essence/Basics/Globe_/Globe_', () => ({ default: {} }))
vi.mock('../../src/essence/Ancillary/CursorInfo', () => ({ default: {} }))
vi.mock('../../src/essence/Ancillary/ContextMenu', () => ({ default: {} }))
vi.mock('../../src/essence/Ancillary/Coordinates', () => ({ default: {} }))
vi.mock('../../src/essence/Basics/TimeControl_/TimeControl', () => ({
    default: {},
}))
vi.mock('../../src/essence/Ancillary/Stylize', () => ({ stylize: vi.fn() }))
vi.mock('../../src/essence/mmgisAPI/mmgisAPI', () => ({ mmgisAPI_: {} }))
vi.mock('../../src/pre/calls', () => ({ default: { api: vi.fn() } }))
vi.mock('../../src/pre/capabilities', () => ({
    isStaticBuild: vi.fn(() => false),
}))

import modern from '../../src/essence/modern'
import { isStaticBuild } from '../../src/pre/capabilities'

const CONFIG = { msv: { mission: 'Baked' } }

beforeEach(() => {
    vi.clearAllMocks()
    isStaticBuild.mockReturnValue(false)
})

test('a static build leaves the URL alone', () => {
    // A bare entry URL is exactly what asks a served build to name its
    // mission, so it is the case that fails loudly if the guard goes: a
    // static dashboard shows the one mission baked into it, and the URL the
    // landing page settled on — flags stripped, no mission named — stands.
    window.history.replaceState({}, '', '/')
    isStaticBuild.mockReturnValue(true)

    modern._updateMissionUrl(CONFIG, false)

    expect(window.location.search).toBe('')
})

test('a served build names the loaded mission', () => {
    window.history.replaceState({}, '', '/?keep=me&forcelanding')

    modern._updateMissionUrl(CONFIG, false)

    expect(window.location.search).toBe('?keep=me&mission=Baked')
})

test('a swap carries the flag through, so the old pairs go', () => {
    window.history.replaceState({}, '', '/?on=Base%20Map&mapLat=1')

    modern._updateMissionUrl(CONFIG, true)

    expect(window.location.search).toBe('?mission=Baked')
})
