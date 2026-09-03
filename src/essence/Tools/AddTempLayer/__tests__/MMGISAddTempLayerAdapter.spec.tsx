import React from 'react'
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import { MMGISAddTempLayerAdapter } from '../MMGISAddTempLayerAdapter'
import { mount, click } from '../../_shared/__tests__/reactHarness'

/**
 * The ✕ is the only way out of the form, and the command behind it is asserted
 * against the request name core registers: one that resolves to nothing leaves
 * a closed form sitting over the map, without an error anyone would notice.
 */

/** The plugin's canonical id, as declared in its config.json. */
const TOOL_ID = 'addtemplayer'

let request: ReturnType<typeof vi.fn>

beforeEach(() => {
    request = vi.fn().mockResolvedValue({ ok: true, state: 'visible', changed: true })
    ;(window as { mmgisAPI?: unknown }).mmgisAPI = {
        request,
        hasHandler: () => true,
        on: () => () => {},
    }
})

afterEach(() => {
    delete (window as { mmgisAPI?: unknown }).mmgisAPI
    document.body.innerHTML = ''
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
    const { container, unmount } = await mount(<MMGISAddTempLayerAdapter />)

    await click(container.querySelector('[aria-label="Close"]') as Element)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(warn).toHaveBeenCalledWith(
        '[AddTempLayer] hide refused: not-found',
    )
    warn.mockRestore()
    await unmount()
})
