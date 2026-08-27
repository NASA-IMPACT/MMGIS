import { test, expect, beforeEach, afterEach, vi } from 'vitest'
vi.mock('../../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))
// loadPlugin reaches a tool's class through its module binding in the real
// tool registry; stand in a minimal module so plugins:show has something to
// load. Its destroy is a spy: whether a tool tore itself down is not visible
// in the plugin listing. The metadata below is written by hand rather than
// generated, so `toolIds` is only here to satisfy the import — the fixture
// states both names outright: 'FakeTool' reaches the module, and 'fake' is the
// id every command in this file names it by.
const { destroySpy } = vi.hoisted(() => ({ destroySpy: vi.fn() }))
vi.mock('../../../src/pre/tools', () => ({
    toolIds: {},
    toolModules: { FakeTool: { make: () => {}, destroy: destroySpy } },
}))

import { mmgisAPI, mmgisAPI_ } from '../../../src/essence/mmgisAPI/mmgisAPI'
import ToolControllerModern_ from '../../../src/essence/Basics/ToolController_/ToolControllerModern_'

beforeEach(() => {
    destroySpy.mockClear()
    document.body.innerHTML = '<div id="fake-target"></div>'
    ToolControllerModern_.registerDeferred(
        { id: 'fake', module: 'FakeTool', name: 'Fake' }, 'fake-target'
    )
    mmgisAPI_._pluginController = ToolControllerModern_
})

afterEach(() => {
    mmgisAPI_._pluginController = null
    // toolIdToTargetId/hiddenTools/deferredTools are module-level singletons
    // shared by every test in this file; without resetting them a plugin
    // loaded by one test leaks into the next test's fixture.
    ToolControllerModern_.destroyAllTools()
    document.body.innerHTML = ''
    vi.restoreAllMocks()
})

test('all four handlers are registered at module load', () => {
    expect(mmgisAPI.hasHandler('plugins:getAll')).toBe(true)
    expect(mmgisAPI.hasHandler('plugins:setState')).toBe(true)
    expect(mmgisAPI.hasHandler('plugins:show')).toBe(true)
    expect(mmgisAPI.hasHandler('plugins:hide')).toBe(true)
})

test('getAll returns the public projection', async () => {
    const plugins = await mmgisAPI.request('plugins:getAll')
    expect(plugins).toContainEqual({ id: 'fake', state: 'unloaded' })
})

test('a malformed payload is a bad-request', async () => {
    expect(await mmgisAPI.request('plugins:hide')).toEqual({ ok: false, reason: 'bad-request' })
    expect(await mmgisAPI.request('plugins:hide', {})).toEqual({ ok: false, reason: 'bad-request' })
    expect(await mmgisAPI.request('plugins:hide', { pluginId: 42 }))
        .toEqual({ ok: false, reason: 'bad-request' })
    expect(await mmgisAPI.request('plugins:setState', { pluginId: 'fake' }))
        .toEqual({ ok: false, reason: 'bad-request' })
})

test('setState with a well-formed but unrecognised state is a bad-request', async () => {
    expect(await mmgisAPI.request('plugins:setState', { pluginId: 'fake', state: 'sideways' }))
        .toEqual({ ok: false, reason: 'bad-request' })
})

test('an unknown plugin is not-found', async () => {
    expect(await mmgisAPI.request('plugins:hide', { pluginId: 'Ghost' }))
        .toEqual({ ok: false, reason: 'not-found' })
})

test('without a controller the layout is inactive', async () => {
    mmgisAPI_._pluginController = null
    expect(await mmgisAPI.request('plugins:getAll')).toEqual([])
    expect(await mmgisAPI.request('plugins:hide', { pluginId: 'fake' }))
        .toEqual({ ok: false, reason: 'layout-inactive' })
})

test('show maps to visible and hide maps to hidden', async () => {
    expect(await mmgisAPI.request('plugins:show', { pluginId: 'fake' }))
        .toEqual({ ok: true, state: 'visible', changed: true })
    expect(await mmgisAPI.request('plugins:hide', { pluginId: 'fake' }))
        .toEqual({ ok: true, state: 'hidden', changed: true })
})

test('a hidden plugin can be shown again', async () => {
    // The instance survives hiding, so restoring it is a reveal rather than a
    // fresh load.
    await mmgisAPI.request('plugins:show', { pluginId: 'fake' })
    await mmgisAPI.request('plugins:hide', { pluginId: 'fake' })
    const card = document.querySelector('#fake-target')
    expect(card.classList.contains('plugin-hidden')).toBe(true)

    expect(await mmgisAPI.request('plugins:show', { pluginId: 'fake' }))
        .toEqual({ ok: true, state: 'visible', changed: true })

    expect(card.classList.contains('plugin-hidden')).toBe(false)
    expect(await mmgisAPI.request('plugins:getAll'))
        .toContainEqual({ id: 'fake', state: 'visible' })
    expect(destroySpy).not.toHaveBeenCalled()
})

test('setState forwards a valid state and returns the controller result unmodified', async () => {
    expect(await mmgisAPI.request('plugins:setState', { pluginId: 'fake', state: 'visible' }))
        .toEqual({ ok: true, state: 'visible', changed: true })
})

test('setState can unload a loaded plugin, tearing down its instance', async () => {
    await mmgisAPI.request('plugins:setState', { pluginId: 'fake', state: 'visible' })

    expect(await mmgisAPI.request('plugins:setState', { pluginId: 'fake', state: 'unloaded' }))
        .toEqual({ ok: true, state: 'unloaded', changed: true })

    const plugins = await mmgisAPI.request('plugins:getAll')
    expect(plugins).toContainEqual({ id: 'fake', state: 'unloaded' })
    // The listing reports bookkeeping; the tool's own teardown is what
    // releases its DOM and listeners.
    expect(destroySpy).toHaveBeenCalled()
})

test('a refused command logs nothing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await mmgisAPI.request('plugins:hide')
    await mmgisAPI.request('plugins:hide', { pluginId: 'Ghost' })
    await mmgisAPI.request('plugins:setState', { pluginId: 'fake', state: 42 })
    await mmgisAPI.request('plugins:setState', { pluginId: 'fake', state: 'sideways' })

    expect(warn).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
})
