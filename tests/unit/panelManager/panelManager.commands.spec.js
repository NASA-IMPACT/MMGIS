import { test, expect, beforeEach, vi } from 'vitest'
vi.mock('../../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))

import { PanelManager } from '../../../src/essence/Basics/PanelManager_/PanelManager_.ts'
import { PANEL_STATE } from '../../../src/essence/Basics/PanelManager_/types/layout.ts'
import { createMockPanelConfig, mockLayoutChangedEvents } from './testHelpers.js'

let panelManager

beforeEach(() => {
    panelManager = new PanelManager()
})

test('setPanelState returns a result instead of throwing for an unknown panel', () => {
    expect(panelManager.setPanelState('nope', PANEL_STATE.COLLAPSED))
        .toEqual({ ok: false, reason: 'not-found' })
})

test('setPanelState refuses a state outside allowedStates', () => {
    panelManager.registerPanel(createMockPanelConfig())
    expect(panelManager.setPanelState('test-panel', PANEL_STATE.ICONIFIED))
        .toEqual({ ok: false, reason: 'state-not-allowed' })
})

test('setting the current state is a quiet no-op', () => {
    panelManager.registerPanel(createMockPanelConfig())
    const mock = mockLayoutChangedEvents()
    const before = mock.events.length
    expect(panelManager.setPanelState('test-panel', PANEL_STATE.EXPANDED))
        .toEqual({ ok: true, state: PANEL_STATE.EXPANDED, changed: false })
    expect(mock.events.length).toBe(before)
})

test('showPanel restores the last visible state', () => {
    panelManager.registerPanel(createMockPanelConfig())
    panelManager.setPanelState('test-panel', PANEL_STATE.COLLAPSED)
    expect(panelManager.showPanel('test-panel'))
        .toEqual({ ok: true, state: PANEL_STATE.EXPANDED, changed: true })
})

test('showPanel prefers the last visible state over the configured default', () => {
    panelManager.registerPanel(createMockPanelConfig({
        id: 'multi',
        stateConstraints: {
            allowedStates: [
                PANEL_STATE.COLLAPSED, PANEL_STATE.ICONIFIED,
                PANEL_STATE.FOCUSED, PANEL_STATE.EXPANDED,
            ],
            defaultState: PANEL_STATE.EXPANDED,
        },
    }))
    panelManager.setPanelState('multi', PANEL_STATE.ICONIFIED)
    panelManager.setPanelState('multi', PANEL_STATE.COLLAPSED)

    // Restores iconified, not the configured default of expanded.
    expect(panelManager.showPanel('multi'))
        .toEqual({ ok: true, state: PANEL_STATE.ICONIFIED, changed: true })
})

test('showPanel reports no-visible-state when constraints allow none', () => {
    panelManager.registerPanel(createMockPanelConfig({
        id: 'stuck',
        stateConstraints: {
            allowedStates: [PANEL_STATE.COLLAPSED],
            defaultState: PANEL_STATE.COLLAPSED,
        },
    }))
    expect(panelManager.showPanel('stuck')).toEqual({ ok: false, reason: 'no-visible-state' })
})

test('canSetState rejects iconified on a float panel', () => {
    panelManager.registerPanel(createMockPanelConfig({
        id: 'floaty',
        position: 'float-top-left',
        stateConstraints: {
            allowedStates: [PANEL_STATE.COLLAPSED, PANEL_STATE.EXPANDED, PANEL_STATE.ICONIFIED],
            defaultState: PANEL_STATE.EXPANDED,
        },
    }))
    expect(panelManager.canSetState('floaty', PANEL_STATE.ICONIFIED)).toBe(false)
    expect(panelManager.canSetState('floaty', PANEL_STATE.COLLAPSED)).toBe(true)
})

test('the changed event payload is frozen and structured-cloneable', () => {
    panelManager.registerPanel(createMockPanelConfig())
    const mock = mockLayoutChangedEvents()
    panelManager.setPanelState('test-panel', PANEL_STATE.COLLAPSED)

    const payload = mock.events[mock.events.length - 1].detail
    expect(Object.isFrozen(payload.panels[0])).toBe(true)
    expect(() => structuredClone(payload)).not.toThrow()
})

test('list projects only the public panel shape', () => {
    panelManager.registerPanel(createMockPanelConfig())
    expect(panelManager.list()).toEqual([{
        id: 'test-panel',
        position: 'left',
        state: PANEL_STATE.EXPANDED,
        toolIds: [],
    }])
})

test('showPanel leaves an already-visible panel alone', () => {
    panelManager.registerPanel(createMockPanelConfig({
        id: 'default-iconified',
        stateConstraints: {
            allowedStates: [
                PANEL_STATE.COLLAPSED, PANEL_STATE.ICONIFIED, PANEL_STATE.EXPANDED,
            ],
            // The stock left-panel shape: the configured default is smaller
            // than the state a user reaches by expanding it.
            defaultState: PANEL_STATE.ICONIFIED,
        },
    }))
    panelManager.setPanelState('default-iconified', PANEL_STATE.EXPANDED)

    const mock = mockLayoutChangedEvents()
    expect(panelManager.showPanel('default-iconified'))
        .toEqual({ ok: true, state: PANEL_STATE.EXPANDED, changed: false })
    expect(panelManager.getPanelState('default-iconified').state)
        .toBe(PANEL_STATE.EXPANDED)
    expect(mock.events.length).toBe(0)
})
