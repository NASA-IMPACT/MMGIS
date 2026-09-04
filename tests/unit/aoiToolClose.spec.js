import { test, expect, beforeEach, afterEach, vi } from 'vitest'
import AOITool from '../../src/essence/Tools/AOI/AOITool.js'

let request

beforeEach(() => {
    request = vi.fn().mockResolvedValue({ ok: true })
    window.mmgisAPI = {
        request,
        hasHandler: () => true,
    }
})

afterEach(() => {
    delete window.mmgisAPI
})

test('closing the panel unloads the AOI plugin', () => {
    AOITool._onClose()

    expect(request).toHaveBeenCalledWith(
        'plugins:setState',
        {
            pluginId: 'aoi',
            state: 'unloaded',
        },
        undefined
    )
})
