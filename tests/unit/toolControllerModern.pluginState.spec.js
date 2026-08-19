import { test, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))
// loadPlugin looks tool ids up in the real tool registry; stand in a minimal
// module so the load-then-show/hide paths in setPluginState have something to
// load. 'GhostTool' is deliberately absent so a test can force a load failure.
vi.mock('../../src/pre/tools', () => ({
    toolModules: { FakeTool: { make: () => {}, destroy: () => {} } },
}))

import ToolControllerModern_ from '../../src/essence/Basics/ToolController_/ToolControllerModern_'
import { mmgisAPI } from '../../src/essence/mmgisAPI/mmgisAPI'

const metadata = { id: 'FakeTool', name: 'Fake Tool' }

// Set by a test that wants to observe plugins:changed; always torn down in
// afterEach rather than at the end of the test body, so a failed assertion
// can't skip the unsubscribe and leak a listener into later tests.
let unsubscribe = null

function listenForChanges() {
    const seen = []
    unsubscribe = mmgisAPI.on('plugins:changed', (p) => seen.push(p))
    return seen
}

beforeEach(() => {
    document.body.innerHTML = '<div id="fake-target"></div>'
    ToolControllerModern_.registerDeferred(metadata, 'fake-target')
})

afterEach(() => {
    if (unsubscribe) {
        unsubscribe()
        unsubscribe = null
    }
    // loadedTools/toolIdToTargetId/hiddenTools/deferredTools are module-level
    // singletons shared by every test in this file; without resetting them a
    // plugin loaded or hidden by one test leaks into the next test's fixture.
    ToolControllerModern_.destroyAllTools()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
})

test('a deferred plugin reads as unloaded', () => {
    expect(ToolControllerModern_.getPluginState('FakeTool')).toBe('unloaded')
})

test('an unknown plugin has no state', () => {
    expect(ToolControllerModern_.getPluginState('NoSuchTool')).toBe(null)
})

test('setting an unknown plugin is not-found', () => {
    expect(ToolControllerModern_.setPluginState('NoSuchTool', 'visible'))
        .toEqual({ ok: false, reason: 'not-found' })
})

test('an unrecognised state is a bad-request', () => {
    expect(ToolControllerModern_.setPluginState('FakeTool', 'sideways'))
        .toEqual({ ok: false, reason: 'bad-request' })
})

test('setting the current state is a quiet no-op', () => {
    const seen = listenForChanges()
    expect(ToolControllerModern_.setPluginState('FakeTool', 'unloaded'))
        .toEqual({ ok: true, state: 'unloaded', changed: false })
    expect(seen).toEqual([])
})

test('a successful transition emits plugins:changed', () => {
    const seen = listenForChanges()

    expect(ToolControllerModern_.setPluginState('FakeTool', 'visible'))
        .toEqual({ ok: true, state: 'visible', changed: true })

    expect(seen).toHaveLength(1)
    expect(seen[0].plugins).toContainEqual({ id: 'FakeTool', state: 'visible' })
})

test('unloaded to hidden loads the plugin and lands it hidden, not visible', () => {
    expect(ToolControllerModern_.setPluginState('FakeTool', 'hidden'))
        .toEqual({ ok: true, state: 'hidden', changed: true })
    expect(ToolControllerModern_.getPluginState('FakeTool')).toBe('hidden')
    expect(document.getElementById('fake-target').classList.contains('plugin-hidden')).toBe(true)
})

test('visible to hidden hides an already-loaded plugin', () => {
    ToolControllerModern_.setPluginState('FakeTool', 'visible')

    expect(ToolControllerModern_.setPluginState('FakeTool', 'hidden'))
        .toEqual({ ok: true, state: 'hidden', changed: true })
    expect(document.getElementById('fake-target').classList.contains('plugin-hidden')).toBe(true)
})

test('a plugin missing from the tool registry fails to load', () => {
    document.body.innerHTML += '<div id="ghost-target"></div>'
    ToolControllerModern_.registerDeferred({ id: 'GhostTool', name: 'Ghost' }, 'ghost-target')

    expect(ToolControllerModern_.setPluginState('GhostTool', 'visible'))
        .toEqual({ ok: false, reason: 'load-failed' })
})

test('listPlugins unions plugins that are in different states', () => {
    document.body.innerHTML += '<div id="second-target"></div>'
    ToolControllerModern_.registerDeferred({ id: 'SecondTool', name: 'Second' }, 'second-target')
    ToolControllerModern_.setPluginState('FakeTool', 'visible')

    const plugins = ToolControllerModern_.listPlugins()
    expect(plugins).toContainEqual({ id: 'FakeTool', state: 'visible' })
    expect(plugins).toContainEqual({ id: 'SecondTool', state: 'unloaded' })
})

test('the listing is frozen and cloneable', () => {
    const plugins = ToolControllerModern_.listPlugins()
    expect(plugins).toContainEqual({ id: 'FakeTool', state: 'unloaded' })
    expect(Object.isFrozen(plugins[0])).toBe(true)
    expect(() => structuredClone(plugins)).not.toThrow()
})

test('a mutator that refuses reports the transition, not a missing plugin', () => {
    ToolControllerModern_.setPluginState('FakeTool', 'visible')
    const seen = listenForChanges()
    // destroyTool keeps the lifecycle registries in step, so the only way a
    // mutator refuses a plugin getPluginState just resolved is those registries
    // disagreeing. Force the refusal rather than corrupting module-private maps
    // no test can reach.
    vi.spyOn(ToolControllerModern_, 'hidePlugin').mockReturnValue(false)

    expect(ToolControllerModern_.setPluginState('FakeTool', 'hidden'))
        .toEqual({ ok: false, reason: 'transition-failed' })
    expect(seen).toEqual([])
})

test('a load batch broadcasts once, after every plugin in it has loaded', () => {
    // A startup batch: one plugin loaded outright, one registered deferred.
    // Separate containers, since a container registerDeferred has touched
    // carries plugin-hidden and would load hidden.
    document.body.innerHTML += '<div id="second-target"></div><div id="third-target"></div>'
    const seen = listenForChanges()

    ToolControllerModern_.runLoadQueue([
        () => ToolControllerModern_.loadTool(metadata, 'second-target'),
        () => ToolControllerModern_.registerDeferred(
            { id: 'SecondTool', name: 'Second' }, 'third-target'
        ),
    ])

    // One event, not one per plugin, and it carries the settled listing rather
    // than the partial one a subscriber seeding mid-batch would have captured.
    expect(seen).toHaveLength(1)
    expect(seen[0].plugins).toContainEqual({ id: 'FakeTool', state: 'visible' })
    expect(seen[0].plugins).toContainEqual({ id: 'SecondTool', state: 'unloaded' })
})

test('a plugin that throws while loading does not stop the batch', () => {
    document.body.innerHTML += '<div id="second-target"></div>'
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const seen = listenForChanges()

    ToolControllerModern_.runLoadQueue([
        () => { throw new Error('boom') },
        () => ToolControllerModern_.registerDeferred(
            { id: 'SecondTool', name: 'Second' }, 'second-target'
        ),
    ])

    expect(seen).toHaveLength(1)
    expect(seen[0].plugins).toContainEqual({ id: 'SecondTool', state: 'unloaded' })
})
