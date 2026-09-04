import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    mmgisGetPanels,
    mmgisSetPanelState,
    mmgisShowPanel,
    mmgisHidePanel,
    mmgisGetPlugins,
    mmgisSetPluginState,
    mmgisShowPlugin,
    mmgisHidePlugin,
    mmgisRequest,
} from '../mmgisAPI'

const request = vi.fn()

beforeEach(() => {
    request.mockReset().mockResolvedValue({ ok: true })
    ;(window as any).mmgisAPI = {
        request,
        hasHandler: () => true,
        emit: vi.fn(),
    }
})

afterEach(() => {
    vi.restoreAllMocks()
    delete (window as any).mmgisAPI
})

// The trailing `undefined` in these assertions is the options slot: the panel
// and plugin wrappers name no caller, so every plugin on them reaches core
// anonymously.
describe('panel adapters', () => {
    test('getPanels resolves an empty list when core has no handler', async () => {
        ;(window as any).mmgisAPI.hasHandler = () => false
        expect(await mmgisGetPanels()).toEqual([])
        expect(request).not.toHaveBeenCalled()
    })

    test('getPanels resolves whatever the handler returns when one is registered', async () => {
        const panels = [{ id: 'left', position: 'left', state: 'expanded', toolIds: [] }]
        request.mockResolvedValue(panels)
        expect(await mmgisGetPanels()).toEqual(panels)
        expect(request).toHaveBeenCalledWith('panels:getAll', undefined, undefined)
    })

    test('getPlugins resolves an empty list when core has no handler', async () => {
        ;(window as any).mmgisAPI.hasHandler = () => false
        expect(await mmgisGetPlugins()).toEqual([])
    })

    test('getPlugins resolves whatever the handler returns when one is registered', async () => {
        const plugins = [{ id: 'DrawTool', state: 'visible' }]
        request.mockResolvedValue(plugins)
        expect(await mmgisGetPlugins()).toEqual(plugins)
        expect(request).toHaveBeenCalledWith('plugins:getAll', undefined, undefined)
    })

    test('setPanelState passes the panelId and state', async () => {
        await mmgisSetPanelState('left', 'expanded')
        expect(request).toHaveBeenCalledWith('panels:setState', { panelId: 'left', state: 'expanded' }, undefined)
    })

    test('showPanel passes the panelId', async () => {
        await mmgisShowPanel('left')
        expect(request).toHaveBeenCalledWith('panels:show', { panelId: 'left' }, undefined)
    })

    test('hidePanel passes the panelId', async () => {
        await mmgisHidePanel('left')
        expect(request).toHaveBeenCalledWith('panels:hide', { panelId: 'left' }, undefined)
    })

    test('setPluginState passes the pluginId and state', async () => {
        await mmgisSetPluginState('draw', 'hidden')
        expect(request).toHaveBeenCalledWith('plugins:setState', { pluginId: 'draw', state: 'hidden' }, undefined)
    })

    test('showPlugin passes the pluginId', async () => {
        await mmgisShowPlugin('draw')
        expect(request).toHaveBeenCalledWith('plugins:show', { pluginId: 'draw' }, undefined)
    })

    test('hidePlugin passes the pluginId', async () => {
        await mmgisHidePlugin('draw')
        expect(request).toHaveBeenCalledWith('plugins:hide', { pluginId: 'draw' }, undefined)
    })

    test('a command falls back to layout-inactive when core has no handler', async () => {
        ;(window as any).mmgisAPI.hasHandler = () => false
        expect(await mmgisSetPanelState('left', 'expanded')).toEqual({ ok: false, reason: 'layout-inactive' })
        expect(await mmgisShowPanel('left')).toEqual({ ok: false, reason: 'layout-inactive' })
        expect(await mmgisHidePanel('left')).toEqual({ ok: false, reason: 'layout-inactive' })
        expect(await mmgisSetPluginState('draw', 'hidden')).toEqual({ ok: false, reason: 'layout-inactive' })
        expect(await mmgisShowPlugin('draw')).toEqual({ ok: false, reason: 'layout-inactive' })
        expect(await mmgisHidePlugin('draw')).toEqual({ ok: false, reason: 'layout-inactive' })
    })

    test('a command passes through whatever result core reports', async () => {
        const notFound = { ok: false, reason: 'not-found' }
        request.mockResolvedValue(notFound)
        expect(await mmgisSetPanelState('ghost', 'expanded')).toEqual(notFound)
    })
})

// Some providers answer per caller — `map:hidePopup` retracts only the card its
// caller opened — so a plugin on this client has to be able to say who it is.
describe('the request client', () => {
    test('stamps the caller when one is given', async () => {
        await mmgisRequest('map:hidePopup', undefined, { caller: 'aoi' })
        expect(request).toHaveBeenCalledWith('map:hidePopup', undefined, {
            caller: 'aoi',
        })
    })

    test('names nobody when none is given', async () => {
        await mmgisRequest('map:hidePopup')
        expect(request).toHaveBeenCalledWith('map:hidePopup', undefined, undefined)
    })
})
