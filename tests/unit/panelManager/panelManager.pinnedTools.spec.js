import { test, expect, vi } from 'vitest'

// PanelManager_ imports mmgisAPI, which transitively pulls in the entire Map_
// rendering stack. These specs only exercise panel logic, so mock it out (the
// adjacent __mocks__ stub) to keep the import graph light.
vi.mock('../../../src/essence/mmgisAPI/mmgisAPI')
import { PanelManager } from '../../../src/essence/Basics/PanelManager_/PanelManager_.ts'
import { PANEL_POSITION } from '../../../src/essence/Basics/PanelManager_/types/layout.ts'
import { TOOL_ORIENTATION } from '../../../src/essence/Basics/ToolController_/types/tool.ts'
import { createMockPanelConfig, createMockToolMetadata, setupWindowEnvironment } from './testHelpers.js'

const tool = (id) => createMockToolMetadata({ id, name: id })

test.describe('PanelManager - Pinned Tools', () => {
    let panelManager

    test.beforeEach(() => {
        setupWindowEnvironment()
        panelManager = new PanelManager()
    })

    test.describe('canPinTools', () => {
        test.each([PANEL_POSITION.LEFT, PANEL_POSITION.RIGHT])('is true for a %s panel', (position) => {
            panelManager.registerPanel(createMockPanelConfig({ position }))
            expect(panelManager.canPinTools('test-panel')).toBe(true)
        })

        test.each([PANEL_POSITION.TOP, PANEL_POSITION.BOTTOM, PANEL_POSITION.FLOAT_TOP_LEFT])(
            'is false for a %s panel',
            (position) => {
                panelManager.registerPanel(
                    createMockPanelConfig({
                        position,
                        capabilities: { supportedOrientation: TOOL_ORIENTATION.ANY },
                    })
                )
                expect(panelManager.canPinTools('test-panel')).toBe(false)
            }
        )

        test('is false for a panel that does not exist', () => {
            expect(panelManager.canPinTools('nope')).toBe(false)
        })
    })

    test.describe('splitting a panel between its regions', () => {
        test.beforeEach(() => {
            panelManager.registerPanel(createMockPanelConfig())
        })

        test('a panel with nothing pinned scrolls all of its tools', () => {
            panelManager.addToolToPanel('test-panel', tool('a'))
            panelManager.addToolToPanel('test-panel', tool('b'))

            expect(panelManager.getPinnedToolsForPanel('test-panel')).toEqual([])
            expect(panelManager.getScrollingToolsForPanel('test-panel').map(t => t.id)).toEqual(['a', 'b'])
        })

        test('pinned tools are reported separately from scrolling ones', () => {
            panelManager.addToolToPanel('test-panel', tool('pinned'), { pinned: true })
            panelManager.addToolToPanel('test-panel', tool('scrolling'))

            expect(panelManager.getPinnedToolsForPanel('test-panel').map(t => t.id)).toEqual(['pinned'])
            expect(panelManager.getScrollingToolsForPanel('test-panel').map(t => t.id)).toEqual(['scrolling'])
        })

        test('pinned tools stay in the panel as a whole, so the icon tray still lists them', () => {
            panelManager.addToolToPanel('test-panel', tool('pinned'), { pinned: true })
            panelManager.addToolToPanel('test-panel', tool('scrolling'))

            expect(panelManager.getToolsForPanel('test-panel').map(t => t.id)).toEqual(['pinned', 'scrolling'])
        })

        test('pinned tools render in the order they were pinned', () => {
            panelManager.addToolToPanel('test-panel', tool('first'), { pinned: true })
            panelManager.addToolToPanel('test-panel', tool('second'), { pinned: true })

            expect(panelManager.getPinnedToolsForPanel('test-panel').map(t => t.id)).toEqual(['first', 'second'])
        })

        test('pinning the same tool twice records it once', () => {
            panelManager.addToolToPanel('test-panel', tool('a'), { pinned: true })
            panelManager.addToolToPanel('test-panel', tool('a'), { pinned: true })

            expect(panelManager.getPinnedToolsForPanel('test-panel').map(t => t.id)).toEqual(['a'])
        })

        test('removing a pinned tool empties the pinned region', () => {
            panelManager.addToolToPanel('test-panel', tool('a'), { pinned: true })
            panelManager.removeToolFromPanel('test-panel', 'a')

            expect(panelManager.getPinnedToolsForPanel('test-panel')).toEqual([])
            expect(panelManager.getScrollingToolsForPanel('test-panel')).toEqual([])
        })

        test('pinned tools count towards the panel capacity', () => {
            const manager = new PanelManager()
            manager.registerPanel(createMockPanelConfig({
                id: 'capped',
                capabilities: { supportedOrientation: TOOL_ORIENTATION.VERTICAL, maxTools: 1 },
            }))
            manager.addToolToPanel('capped', tool('a'), { pinned: true })

            expect(() => manager.addToolToPanel('capped', tool('b'))).toThrow(/maximum capacity/)
        })
    })

    test('a panel with no pinned region keeps a pin request in its scrolling body', () => {
        panelManager.registerPanel(
            createMockPanelConfig({
                position: PANEL_POSITION.TOP,
                capabilities: { supportedOrientation: TOOL_ORIENTATION.ANY },
            })
        )
        panelManager.addToolToPanel('test-panel', tool('a'), { pinned: true })

        expect(panelManager.getPinnedToolsForPanel('test-panel')).toEqual([])
        expect(panelManager.getScrollingToolsForPanel('test-panel').map(t => t.id)).toEqual(['a'])
    })

    test('queries on an unknown panel return empty arrays', () => {
        expect(panelManager.getPinnedToolsForPanel('nope')).toEqual([])
        expect(panelManager.getScrollingToolsForPanel('nope')).toEqual([])
    })
})
