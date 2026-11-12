import { test, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))
// A tool that writes a share-link entry, and one that does not.
vi.mock('../../src/pre/tools', () => ({
    toolModules: {
        LinkedTool: { make: () => {}, destroy: () => {}, getUrlString: () => 'layers|swipe|a|b||0|0.30' },
        QuietTool: { make: () => {}, destroy: () => {}, getUrlString: () => '' },
    },
    toolConfigs: {},
}))

import ToolControllerModern_ from '../../src/essence/Basics/ToolController_/ToolControllerModern_'
import ToolController_ from '../../src/essence/Basics/ToolController_/ToolController_'

// The share link's `tools=` entry comes from the classic controller's list of
// tool module names, which only the classic layout's init fills. The modern
// layout loads tools through its own controller, so it has to join that list
// or no modern tool could ever write itself into a link.

beforeEach(() => {
    document.body.innerHTML = '<div id="linked"></div><div id="quiet"></div>'
    ToolController_.toolModuleNames = []
})

afterEach(() => {
    ToolControllerModern_.destroyAllTools()
    document.body.innerHTML = ''
})

test('a loaded modern tool writes its entry into the tools url', () => {
    ToolControllerModern_.loadTool({ id: 'LinkedTool', name: 'Linked' }, 'linked')
    ToolControllerModern_.loadTool({ id: 'QuietTool', name: 'Quiet' }, 'quiet')

    expect(ToolController_.getToolsUrl()).toBe('LinkedTool$layers|swipe|a|b||0|0.30')
})

test('a destroyed tool leaves the list, and with none loaded there is no entry', () => {
    ToolControllerModern_.loadTool({ id: 'LinkedTool', name: 'Linked' }, 'linked')
    ToolControllerModern_.destroyTool('linked')

    expect(ToolController_.toolModuleNames).toEqual([])
    expect(ToolController_.getToolsUrl()).toBe(false)
})

test('reloading a tool into another container lists it once', () => {
    ToolControllerModern_.loadTool({ id: 'LinkedTool', name: 'Linked' }, 'linked')
    ToolControllerModern_.loadTool({ id: 'LinkedTool', name: 'Linked' }, 'quiet')

    expect(ToolController_.toolModuleNames.filter((n) => n === 'LinkedTool')).toHaveLength(1)
})
