import { test, expect, vi } from 'vitest'
vi.mock('../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))

import PanelManager_ from '../../src/essence/Basics/PanelManager_/PanelManager_.ts'

// The float regions wrapper carries panelSettings.floatingOffset
// ([top, right, bottom, left]) as --ui-float-offset-{side}, and the CSS insets
// the wrapper by those values.

const { _renderFloatRegions, _toFloatOffsets } = await import(
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

const offsetsOf = (regions) =>
    ['top', 'right', 'bottom', 'left'].map((side) =>
        regions[0].style.getPropertyValue(`--ui-float-offset-${side}`)
    )

test('each configured side insets the float regions', () => {
    expect(offsetsOf(_renderFloatRegions(floatPanels(), [8, 16, 32, 4]))).toEqual([
        '8px',
        '16px',
        '32px',
        '4px',
    ])
})

test('without offsets the zones stay on the edges', () => {
    expect(offsetsOf(_renderFloatRegions(floatPanels()))).toEqual(['', '', '', ''])
    expect(offsetsOf(_renderFloatRegions(floatPanels(), [0, 0, 0, 0]))).toEqual(['', '', '', ''])
})

test('the configured array is read as four capped pixel counts', () => {
    expect(_toFloatOffsets([0, '12', '24px', 4])).toEqual([0, 12, 24, 4])
    expect(_toFloatOffsets([null, null, 32])).toEqual([0, 0, 32, 0])
    expect(_toFloatOffsets(['', -5, 'abc', 500])).toEqual([0, 0, 0, 200])
    expect(_toFloatOffsets([1, 2, 3, 4, 5])).toEqual([1, 2, 3, 4])
    expect(_toFloatOffsets(undefined)).toEqual([0, 0, 0, 0])
    expect(_toFloatOffsets(24)).toEqual([0, 0, 0, 0])
})
