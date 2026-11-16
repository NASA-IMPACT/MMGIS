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

beforeEach(() => {
    document.body.innerHTML = '<div id="linked"></div><div id="quiet"></div>'
})

afterEach(() => {
    ToolControllerModern_.destroyAllTools()
    document.body.innerHTML = ''
})

test('a loaded modern tool writes its entry into the tools url', () => {
    ToolControllerModern_.loadTool({ id: 'LinkedTool', name: 'Linked' }, 'linked')
    ToolControllerModern_.loadTool({ id: 'QuietTool', name: 'Quiet' }, 'quiet')

    expect(ToolControllerModern_.getToolsUrl()).toBe('LinkedTool$layers|swipe|a|b||0|0.30')
})

test('a destroyed tool leaves the url, and with none loaded there is no entry', () => {
    ToolControllerModern_.loadTool({ id: 'LinkedTool', name: 'Linked' }, 'linked')
    ToolControllerModern_.destroyTool('linked')

    expect(ToolControllerModern_.getToolsUrl()).toBe(false)
})

test('a tool loaded into a second container is listed once', () => {
    ToolControllerModern_.loadTool({ id: 'LinkedTool', name: 'Linked' }, 'linked')
    ToolControllerModern_.loadTool({ id: 'LinkedTool', name: 'Linked' }, 'quiet')

    expect(ToolControllerModern_.getToolsUrl()).toBe('LinkedTool$layers|swipe|a|b||0|0.30')
})
