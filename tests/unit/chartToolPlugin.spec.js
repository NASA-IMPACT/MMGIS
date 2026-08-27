import { test, expect, beforeEach, afterEach, vi } from 'vitest'

// ChartTool subscribes to the bus at module scope on import, so the mock has
// to be in place before the module is (re-)evaluated — hence the dynamic
// import per test rather than one static import for the file.
let request
let listeners

function installMmgisAPI() {
    listeners = {}
    request = vi.fn().mockResolvedValue({ ok: true })
    window.mmgisAPI = {
        request,
        hasHandler: () => true,
        on: (event, handler) => {
            listeners[event] = handler
            return () => {
                delete listeners[event]
            }
        },
    }
}

beforeEach(() => {
    vi.resetModules()
    installMmgisAPI()
})

afterEach(() => {
    delete window.mmgisAPI
    document.body.innerHTML = ''
})

test('a fresh analysisReady payload asks the bus to show the Chart plugin', async () => {
    await import('../../src/essence/Tools/Chart/ChartTool.js')
    expect(listeners['plugin:fetch-stats:analysisReady']).toBeTypeOf('function')

    listeners['plugin:fetch-stats:analysisReady']({ analysisData: { layerA: {} } })

    expect(request).toHaveBeenCalledWith('plugins:show', { pluginId: 'chart' })
})

test('closing the panel unloads the Chart plugin', async () => {
    const { default: ChartTool } = await import('../../src/essence/Tools/Chart/ChartTool.js')

    ChartTool._onClose()

    expect(request).toHaveBeenCalledWith('plugins:setState', {
        pluginId: 'chart',
        state: 'unloaded',
    })
})
