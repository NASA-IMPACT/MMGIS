import { test, expect, vi } from 'vitest'
vi.mock('../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))

import PanelManager_ from '../../src/essence/Basics/PanelManager_/PanelManager_.ts'

// The bottom float zones read --ui-float-bottom-offset, which the float
// regions wrapper carries from panelSettings.floatingBottomOffset.

const { _renderFloatRegions } = await import(
    '../../src/essence/Basics/UserInterface_/UserInterfaceModern_.js'
)

const floatPanels = () => {
    PanelManager_.clear()
    PanelManager_.registerPanel({
        id: 'scale',
        position: 'float-bottom-left',
        layoutType: 'stacked',
        priority: 0,
        stateConstraints: { allowedStates: ['expanded'], defaultState: 'expanded' },
    })
    return [PanelManager_.getPanelState('scale')]
}

const offsetOf = (regions) => regions[0].style.getPropertyValue('--ui-float-bottom-offset')

test('a configured offset raises the bottom float zones', () => {
    expect(offsetOf(_renderFloatRegions(floatPanels(), 24))).toBe('24px')
})

test('without an offset the zones stay on the edge', () => {
    expect(offsetOf(_renderFloatRegions(floatPanels()))).toBe('')
    expect(offsetOf(_renderFloatRegions(floatPanels(), 0))).toBe('')
})
