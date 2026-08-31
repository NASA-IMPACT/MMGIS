import React from 'react'
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    MMGISAddTempLayerAdapter,
    ADD_TEMP_LAYER_SHOW_EVENT,
} from '../MMGISAddTempLayerAdapter'
import { mount, click } from '../../_shared/__tests__/reactHarness'

/**
 * The tool starts hidden and ships no trigger of its own, so the bus is the
 * only way in or out of it. Both directions are asserted against the request
 * names core registers — a call that resolves to nothing leaves the form
 * permanently unreachable, and does it without an error anyone would notice.
 */

const TOOL_ID = 'AddTempLayerTool'

let request: ReturnType<typeof vi.fn>
let listeners: Record<string, (payload?: unknown) => void>

beforeEach(() => {
    listeners = {}
    request = vi.fn().mockResolvedValue({ ok: true, state: 'visible', changed: true })
    ;(window as { mmgisAPI?: unknown }).mmgisAPI = {
        request,
        hasHandler: () => true,
        on: (event: string, handler: (payload?: unknown) => void) => {
            listeners[event] = handler
            return () => {
                delete listeners[event]
            }
        },
    }
})

afterEach(() => {
    delete (window as { mmgisAPI?: unknown }).mmgisAPI
    document.body.innerHTML = ''
})

test('the show event reveals the plugin over the bus', async () => {
    const { unmount } = await mount(<MMGISAddTempLayerAdapter />)

    expect(listeners[ADD_TEMP_LAYER_SHOW_EVENT]).toBeTypeOf('function')
    listeners[ADD_TEMP_LAYER_SHOW_EVENT]()

    expect(request).toHaveBeenCalledWith('plugins:show', { pluginId: TOOL_ID })
    await unmount()
})

test('the close button hides the plugin over the bus', async () => {
    const { container, unmount } = await mount(<MMGISAddTempLayerAdapter />)

    const closeButton = container.querySelector('[aria-label="Close"]')
    expect(closeButton).not.toBeNull()
    await click(closeButton as Element)

    expect(request).toHaveBeenCalledWith('plugins:hide', { pluginId: TOOL_ID })
    await unmount()
})

test('a refused command is reported rather than dropped', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    request.mockResolvedValue({ ok: false, reason: 'not-found' })
    const { unmount } = await mount(<MMGISAddTempLayerAdapter />)

    listeners[ADD_TEMP_LAYER_SHOW_EVENT]()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(warn).toHaveBeenCalledWith(
        '[AddTempLayer] show refused: not-found',
    )
    warn.mockRestore()
    await unmount()
})
