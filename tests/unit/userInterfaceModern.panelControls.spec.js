import { test, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))

// Assert against the logger the module actually calls rather than console.warn:
// UserInterfaceModern_ logs refusals through createLogger()'s warn method, and
// that method's own delegation to console is an implementation detail of
// Logger_, not of the code under test here.
const { warnSpy } = vi.hoisted(() => ({ warnSpy: vi.fn() }))
vi.mock('../../src/essence/Basics/Logger_/Logger_', () => ({
    createLogger: () => ({
        debug: vi.fn(),
        log: vi.fn(),
        warn: warnSpy,
        error: vi.fn(),
    }),
}))

import { mmgisAPI, mmgisAPI_ } from '../../src/essence/mmgisAPI/mmgisAPI'
import PanelManager_ from '../../src/essence/Basics/PanelManager_/PanelManager_.ts'
import { PANEL_STATE } from '../../src/essence/Basics/PanelManager_/types/layout.ts'

// jsdom has no ResizeObserver; UserInterfaceModern_.init() constructs one to
// watch the center map area for size changes.
global.ResizeObserver = global.ResizeObserver || class {
    observe() {}
    disconnect() {}
}

const config = (id, allowedStates) => ({
    id,
    position: 'left',
    layoutType: 'stacked',
    priority: 0,
    hasHeader: true,
    stateConstraints: { allowedStates, defaultState: PANEL_STATE.EXPANDED },
})

beforeEach(() => {
    mmgisAPI_._panelManager = PanelManager_
    warnSpy.mockClear()
})
afterEach(() => {
    vi.restoreAllMocks()
    mmgisAPI_._panelManager = null
})

test('the close button issues a panels:hide request', async () => {
    PanelManager_.registerPanel(config('ui-panel', [PANEL_STATE.EXPANDED, PANEL_STATE.COLLAPSED]))
    const spy = vi.spyOn(mmgisAPI, 'request')

    const { _createPanelHeader } = await import(
        '../../src/essence/Basics/UserInterface_/UserInterfaceModern_.js'
    )
    const header = _createPanelHeader(PanelManager_.getPanelState('ui-panel'))
    header.find('.ui-panel-btn-close').trigger('click')

    expect(spy).toHaveBeenCalledWith('panels:hide', { panelId: 'ui-panel' })
    PanelManager_.unregisterPanel('ui-panel')
})

test('a button for a disallowed state is not rendered', async () => {
    PanelManager_.registerPanel(config('no-collapse', [PANEL_STATE.EXPANDED]))

    const { _createPanelHeader } = await import(
        '../../src/essence/Basics/UserInterface_/UserInterfaceModern_.js'
    )
    const header = _createPanelHeader(PanelManager_.getPanelState('no-collapse'))

    expect(header.find('.ui-panel-btn-close').length).toBe(0)
    expect(header.find('.ui-panel-btn-maximize').length).toBe(1)
    PanelManager_.unregisterPanel('no-collapse')
})

test('init wires syncDOMState to the panels:changed event', async () => {
    const { default: UserInterfaceModern_ } = await import(
        '../../src/essence/Basics/UserInterface_/UserInterfaceModern_.js'
    )

    // Spy before init(): init() binds this.syncDOMState once and hands that
    // bound function to mmgisAPI.on, so spying afterward would miss calls
    // routed through the reference captured at bind time.
    const spy = vi.spyOn(UserInterfaceModern_, 'syncDOMState')
    UserInterfaceModern_.init([], 'overlay', 'default')
    spy.mockClear() // init()'s own render() pass already invokes it once

    mmgisAPI.emit('panels:changed', Object.freeze({ panels: [] }))

    expect(spy).toHaveBeenCalled()
    UserInterfaceModern_.destroy()
})

test('a refused panel command logs a warning instead of throwing', async () => {
    PanelManager_.registerPanel(config('warn-panel', [PANEL_STATE.EXPANDED, PANEL_STATE.COLLAPSED]))

    const { _createPanelHeader } = await import(
        '../../src/essence/Basics/UserInterface_/UserInterfaceModern_.js'
    )
    const header = _createPanelHeader(PanelManager_.getPanelState('warn-panel'))

    // Unregistering before the click means the request the button issues
    // resolves to { ok: false, reason: 'not-found' } — a stand-in for any
    // refusal, since every refusal reaches the UI as the same shape.
    PanelManager_.unregisterPanel('warn-panel')

    expect(() => header.find('.ui-panel-btn-close').trigger('click')).not.toThrow()

    // The button handler awaits the request Promise before warning, so let
    // that microtask settle before checking the logger.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(warnSpy.mock.calls[0][0]).toContain('refused')
})

test('the minimize button prefers iconified when the panel allows it', async () => {
    PanelManager_.registerPanel(config('iconify-panel', [PANEL_STATE.EXPANDED, PANEL_STATE.ICONIFIED]))
    const spy = vi.spyOn(mmgisAPI, 'request')

    const { _createPanelHeader } = await import(
        '../../src/essence/Basics/UserInterface_/UserInterfaceModern_.js'
    )
    const header = _createPanelHeader(PanelManager_.getPanelState('iconify-panel'))
    header.find('.ui-panel-btn-minimize').trigger('click')

    expect(spy).toHaveBeenCalledWith('panels:setState', { panelId: 'iconify-panel', state: PANEL_STATE.ICONIFIED })
    PanelManager_.unregisterPanel('iconify-panel')
})

test('the minimize button falls back to collapsed when the panel disallows iconified', async () => {
    PanelManager_.registerPanel(config('collapse-only-panel', [PANEL_STATE.EXPANDED, PANEL_STATE.COLLAPSED]))
    const spy = vi.spyOn(mmgisAPI, 'request')

    const { _createPanelHeader } = await import(
        '../../src/essence/Basics/UserInterface_/UserInterfaceModern_.js'
    )
    const header = _createPanelHeader(PanelManager_.getPanelState('collapse-only-panel'))
    header.find('.ui-panel-btn-minimize').trigger('click')

    expect(spy).toHaveBeenCalledWith('panels:setState', { panelId: 'collapse-only-panel', state: PANEL_STATE.COLLAPSED })
    PanelManager_.unregisterPanel('collapse-only-panel')
})
