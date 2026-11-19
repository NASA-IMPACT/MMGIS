import { test, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))
// A tool that writes a share-link entry, one that does not, and three that
// misbehave: one throws, one returns no string, one writes reserved characters.
vi.mock('../../src/pre/tools', () => ({
    toolModules: {
        LinkedTool: { make: () => {}, destroy: () => {}, getUrlString: () => 'layers|swipe|a|b||0|0.30' },
        QuietTool: { make: () => {}, destroy: () => {}, getUrlString: () => '' },
        ThrowingTool: {
            make: () => {},
            destroy: () => {},
            getUrlString: () => {
                throw new Error('boom')
            },
        },
        BareTool: { make: () => {}, destroy: () => {}, getUrlString: () => undefined },
        PunctuatedTool: { make: () => {}, destroy: () => {}, getUrlString: () => 'a,b&c#d$e|f' },
    },
    toolConfigs: {},
}))

const LINKED_ENTRY = 'LinkedTool$' + encodeURIComponent('layers|swipe|a|b||0|0.30')

import ToolControllerModern_ from '../../src/essence/Basics/ToolController_/ToolControllerModern_'

beforeEach(() => {
    document.body.innerHTML =
        '<div id="linked"></div><div id="quiet"></div><div id="throwing"></div><div id="bare"></div><div id="punctuated"></div>'
})

afterEach(() => {
    ToolControllerModern_.destroyAllTools()
    document.body.innerHTML = ''
})

test('a loaded modern tool writes its entry into the tools url', () => {
    ToolControllerModern_.loadTool({ id: 'LinkedTool', name: 'Linked' }, 'linked')
    ToolControllerModern_.loadTool({ id: 'QuietTool', name: 'Quiet' }, 'quiet')

    expect(ToolControllerModern_.getToolsUrl()).toBe(LINKED_ENTRY)
})

test('a destroyed tool leaves the url, and with none loaded there is no entry', () => {
    ToolControllerModern_.loadTool({ id: 'LinkedTool', name: 'Linked' }, 'linked')
    ToolControllerModern_.destroyTool('linked')

    expect(ToolControllerModern_.getToolsUrl()).toBe(false)
})

test('a tool loaded into a second container is listed once', () => {
    ToolControllerModern_.loadTool({ id: 'LinkedTool', name: 'Linked' }, 'linked')
    ToolControllerModern_.loadTool({ id: 'LinkedTool', name: 'Linked' }, 'quiet')

    expect(ToolControllerModern_.getToolsUrl()).toBe(LINKED_ENTRY)
})

test('a tool whose getUrlString throws or returns no string is left out', () => {
    ToolControllerModern_.loadTool({ id: 'ThrowingTool', name: 'Throwing' }, 'throwing')
    ToolControllerModern_.loadTool({ id: 'LinkedTool', name: 'Linked' }, 'linked')
    ToolControllerModern_.loadTool({ id: 'BareTool', name: 'Bare' }, 'bare')

    expect(ToolControllerModern_.getToolsUrl()).toBe(LINKED_ENTRY)
})

// The link joins entries with ',' and the query ends at '#', so a tool's text
// must not carry either raw.
test("reserved characters in a tool's text stay inside its one entry", () => {
    ToolControllerModern_.loadTool({ id: 'PunctuatedTool', name: 'Punctuated' }, 'punctuated')
    ToolControllerModern_.loadTool({ id: 'LinkedTool', name: 'Linked' }, 'linked')

    const entries = ToolControllerModern_.getToolsUrl().split(',')
    expect(entries).toHaveLength(2)
    const [id, text] = entries[0].split('$')
    expect(id).toBe('PunctuatedTool')
    expect(decodeURIComponent(text)).toBe('a,b&c#d$e|f')
})
