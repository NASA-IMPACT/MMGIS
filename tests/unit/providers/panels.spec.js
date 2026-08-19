import { test, expect, beforeEach, afterEach, vi } from 'vitest'
vi.mock('../../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))

import { mmgisAPI, mmgisAPI_ } from '../../../src/essence/mmgisAPI/mmgisAPI'
import PanelManager_ from '../../../src/essence/Basics/PanelManager_/PanelManager_.ts'
import { PANEL_STATE } from '../../../src/essence/Basics/PanelManager_/types/layout.ts'

const config = (id) => ({
    id,
    position: 'left',
    layoutType: 'stacked',
    priority: 0,
    stateConstraints: {
        allowedStates: [PANEL_STATE.EXPANDED, PANEL_STATE.COLLAPSED],
        defaultState: PANEL_STATE.EXPANDED,
    },
    capabilities: { resizable: true },
})

const floatConfig = (id) => ({
    id,
    position: 'float-top-left',
    priority: 0,
    stateConstraints: {
        // 'iconified' is allowed by these constraints so the only thing that
        // can still reject it is the FLOAT_POSITIONS gate in canSetState.
        allowedStates: [PANEL_STATE.COLLAPSED, PANEL_STATE.EXPANDED, PANEL_STATE.ICONIFIED],
        defaultState: PANEL_STATE.EXPANDED,
    },
    capabilities: {},
})

beforeEach(() => {
    mmgisAPI_._panelManager = PanelManager_
    PanelManager_.registerPanel(config('left-panel'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
    PanelManager_.unregisterPanel('left-panel')
    mmgisAPI_._panelManager = null
    vi.restoreAllMocks()
})

test('all four handlers are registered at module load', () => {
    expect(mmgisAPI.hasHandler('panels:getAll')).toBe(true)
    expect(mmgisAPI.hasHandler('panels:setState')).toBe(true)
    expect(mmgisAPI.hasHandler('panels:show')).toBe(true)
    expect(mmgisAPI.hasHandler('panels:hide')).toBe(true)
})

test('hide collapses and is idempotent', async () => {
    expect(await mmgisAPI.request('panels:hide', { panelId: 'left-panel' }))
        .toEqual({ ok: true, state: 'collapsed', changed: true })
    expect(await mmgisAPI.request('panels:hide', { panelId: 'left-panel' }))
        .toEqual({ ok: true, state: 'collapsed', changed: false })
})

test('show restores the last visible state', async () => {
    await mmgisAPI.request('panels:hide', { panelId: 'left-panel' })
    expect(await mmgisAPI.request('panels:show', { panelId: 'left-panel' }))
        .toEqual({ ok: true, state: 'expanded', changed: true })
})

test('a malformed payload is a bad-request', async () => {
    expect(await mmgisAPI.request('panels:hide')).toEqual({ ok: false, reason: 'bad-request' })
    expect(await mmgisAPI.request('panels:hide', {})).toEqual({ ok: false, reason: 'bad-request' })
    expect(await mmgisAPI.request('panels:hide', { panelId: 42 }))
        .toEqual({ ok: false, reason: 'bad-request' })
    expect(await mmgisAPI.request('panels:setState', { panelId: 'left-panel' }))
        .toEqual({ ok: false, reason: 'bad-request' })
    expect(console.warn).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
})

test('an unknown panel is not-found', async () => {
    expect(await mmgisAPI.request('panels:hide', { panelId: 'ghost' }))
        .toEqual({ ok: false, reason: 'not-found' })
    expect(console.warn).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
})

test('without a manager the layout is inactive', async () => {
    mmgisAPI_._panelManager = null
    expect(await mmgisAPI.request('panels:getAll')).toEqual([])
    expect(await mmgisAPI.request('panels:hide', { panelId: 'left-panel' }))
        .toEqual({ ok: false, reason: 'layout-inactive' })
    expect(console.warn).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
    mmgisAPI_._panelManager = PanelManager_
})

test('a disallowed state surfaces state-not-allowed unmodified', async () => {
    expect(await mmgisAPI.request('panels:setState', { panelId: 'left-panel', state: 'iconified' }))
        .toEqual({ ok: false, reason: 'state-not-allowed' })
    expect(console.warn).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
})

test('show is a no-op on an already-visible panel', async () => {
    expect(await mmgisAPI.request('panels:show', { panelId: 'left-panel' }))
        .toEqual({ ok: true, state: 'expanded', changed: false })
})

test('a float panel rejects iconified through the FLOAT_POSITIONS restriction', async () => {
    PanelManager_.registerPanel(floatConfig('float-panel'))
    try {
        expect(await mmgisAPI.request('panels:setState', { panelId: 'float-panel', state: 'iconified' }))
            .toEqual({ ok: false, reason: 'state-not-allowed' })
    } finally {
        PanelManager_.unregisterPanel('float-panel')
    }
})

test('getAll returns the public projection', async () => {
    const panels = await mmgisAPI.request('panels:getAll')
    expect(panels).toEqual([{
        id: 'left-panel',
        position: 'left',
        state: 'expanded',
        toolIds: [],
    }])
})
