import { test, expect, beforeEach, afterEach, vi } from 'vitest'

// Viewer_ drags the photosphere, model and PDF viewers in with it; nothing
// here touches a viewer, so the aggregator is stubbed to keep the import light.
vi.mock('../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))

import L_ from '../../src/essence/Basics/Layers_/Layers_'

// The opening link's `tools=` entry, as QueryURL leaves it on L_.FUTURES: one
// 'ModuleName$text' string per tool that wrote one. L_ is a shared singleton.
let savedTools
beforeEach(() => {
    savedTools = L_.FUTURES?.tools
    L_.FUTURES = L_.FUTURES || {}
})
afterEach(() => {
    L_.FUTURES.tools = savedTools
})

test.describe('L_.getToolUrlState', () => {
    test('answers the text after the module name, for that module only', () => {
        L_.FUTURES.tools = ['LayersTool$1.0', 'ComparisonTool$layers|swipe|a|b||0|0.30', 'ShadeTool$x']
        expect(L_.getToolUrlState('ComparisonTool')).toBe('layers|swipe|a|b||0|0.30')
        expect(L_.getToolUrlState('LayersTool')).toBe('1.0')
    })

    test('null when the link named no tools, or not this one', () => {
        L_.FUTURES.tools = undefined
        expect(L_.getToolUrlState('ComparisonTool')).toBeNull()
        L_.FUTURES.tools = ['LayersTool$1.0']
        expect(L_.getToolUrlState('ComparisonTool')).toBeNull()
    })

    // A modern entry is written with encodeURIComponent; reading undoes it.
    test('decodes an encoded entry, reserved characters included', () => {
        L_.FUTURES.tools = ['ComparisonTool$' + encodeURIComponent('a,b&c#d$e|f')]
        expect(L_.getToolUrlState('ComparisonTool')).toBe('a,b&c#d$e|f')
    })

    // Classic tools write raw text, which may not be valid percent-encoding.
    test('returns a classic entry as written when it does not decode', () => {
        L_.FUTURES.tools = ['ShadeTool$100%+on']
        expect(L_.getToolUrlState('ShadeTool')).toBe('100%+on')
    })

    // 'Comparison' must not match 'ComparisonTool$...'.
    test('matches the whole module name, not a prefix of it', () => {
        L_.FUTURES.tools = ['ComparisonTool$layers|swipe|a|b||0|0.30']
        expect(L_.getToolUrlState('Comparison')).toBeNull()
        expect(L_.getToolUrlState(42)).toBeNull()
    })
})
