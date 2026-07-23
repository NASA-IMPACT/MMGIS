import { describe, it, expect, vi } from 'vitest'
import {
    executeCommand,
    getViewState,
} from '../../src/essence/MMGIS-Plugin-Components/AgentBridge/commands'

function makeDeps() {
    return {
        Map_: {
            resetView: vi.fn(),
            map: { getCenter: () => ({ lat: 1, lng: 2 }), getZoom: () => 5 },
        },
        L_: {
            mission: 'Demo',
            asLayerUUID: (v) => (v === 'NO2' || v === 'uuid-1' ? 'uuid-1' : null),
            layers: { data: { 'uuid-1': { name: 'NO2' } }, on: { 'uuid-1': false } },
            toggleLayer: vi.fn(async function (l) {
                this.layers.on['uuid-1'] = !this.layers.on['uuid-1']
            }),
        },
        ToolAdapter: {
            mode: 'classic',
            activeToolName: vi.fn(() => 'LayerManager'),
            openTool: vi.fn((name) =>
                name === 'Chart'
                    ? { ok: true, activeTool: 'Chart' }
                    : { ok: false, error: `Unknown or unopenable tool: ${name}` }
            ),
        },
        TimeControl: {
            setTime: vi.fn(() => true),
            getTime: () => '2026-06-01T00:00:00Z',
        },
    }
}

describe('executeCommand', () => {
    it('fly_to validates lat/lon and calls Map_.resetView', async () => {
        const deps = makeDeps()
        const res = await executeCommand('fly_to', { lat: 33.7, lon: -84.4, zoom: 9 }, deps)
        expect(res.ok).toBe(true)
        expect(deps.Map_.resetView).toHaveBeenCalledWith([33.7, -84.4, 9])
    })
    it('fly_to rejects non-numeric coordinates', async () => {
        const res = await executeCommand('fly_to', { lat: 'x', lon: 0 }, makeDeps())
        expect(res.ok).toBe(false)
        expect(res.error).toMatch(/lat/)
    })
    it('toggle_layer resolves names to uuids and toggles', async () => {
        const deps = makeDeps()
        const res = await executeCommand('toggle_layer', { layer: 'NO2' }, deps)
        expect(res.ok).toBe(true)
        expect(res.result).toEqual({ layer: 'uuid-1', on: true })
    })
    it('toggle_layer is a no-op when already in the requested state', async () => {
        const deps = makeDeps()
        const res = await executeCommand('toggle_layer', { layer: 'NO2', on: false }, deps)
        expect(res.ok).toBe(true)
        expect(deps.L_.toggleLayer).not.toHaveBeenCalled()
    })
    it('toggle_layer errors on unknown layers', async () => {
        const res = await executeCommand('toggle_layer', { layer: 'Nope' }, makeDeps())
        expect(res.ok).toBe(false)
        expect(res.error).toMatch(/Unknown layer/)
    })
    it('open_tool delegates to ToolAdapter.openTool and reports the resulting active tool', async () => {
        const deps = makeDeps()
        const res = await executeCommand('open_tool', { name: 'Chart' }, deps)
        expect(res.ok).toBe(true)
        expect(deps.ToolAdapter.openTool).toHaveBeenCalledWith('Chart')
        expect(res.result).toEqual({ activeTool: 'Chart' })
    })
    it('open_tool requires a tool name', async () => {
        const res = await executeCommand('open_tool', {}, makeDeps())
        expect(res.ok).toBe(false)
        expect(res.error).toMatch(/tool name/)
    })
    it('open_tool returns ok:false for unknown/unopenable tools instead of faking success', async () => {
        const deps = makeDeps()
        const res = await executeCommand('open_tool', { name: 'NotARealTool' }, deps)
        expect(res.ok).toBe(false)
        expect(res.error).toMatch(/Unknown or unopenable tool: NotARealTool/)
    })
    it('open_tool is honest when no ToolAdapter is available', async () => {
        const deps = makeDeps()
        deps.ToolAdapter = undefined
        const res = await executeCommand('open_tool', { name: 'Chart' }, deps)
        expect(res.ok).toBe(false)
        expect(res.error).toMatch(/not supported/)
    })
    it('set_time requires startTime and endTime', async () => {
        const res = await executeCommand('set_time', { startTime: '2026-01-01T00:00:00Z' }, makeDeps())
        expect(res.ok).toBe(false)
    })
    it('set_time sets the time range and returns the current time', async () => {
        const deps = makeDeps()
        const res = await executeCommand(
            'set_time',
            { startTime: '2026-01-01T00:00:00Z', endTime: '2026-06-01T00:00:00Z' },
            deps
        )
        expect(res.ok).toBe(true)
        expect(res.result.currentTime).toBe('2026-06-01T00:00:00Z')
        expect(deps.TimeControl.setTime).toHaveBeenCalledWith(
            '2026-01-01T00:00:00Z',
            '2026-06-01T00:00:00Z',
            false,
            '00:00:00',
            undefined
        )
    })
    it('get_view_state reports mission, center, zoom, layers, tool', async () => {
        const deps = makeDeps()
        const res = await executeCommand('get_view_state', {}, deps)
        expect(res.ok).toBe(true)
        expect(res.result.mission).toBe('Demo')
        expect(res.result.center).toEqual({ lat: 1, lng: 2 })
        expect(res.result.zoom).toBe(5)
        expect(res.result.activeTool).toBe('LayerManager')
        expect(res.result.layersOn).toEqual(deps.L_.layers.on)
        expect(res.result.currentTime).toBe('2026-06-01T00:00:00Z')
    })
    it('rejects unknown commands', async () => {
        const res = await executeCommand('rm_rf', {}, makeDeps())
        expect(res.ok).toBe(false)
        expect(res.error).toMatch(/Unknown command/)
    })
})

describe('getViewState', () => {
    it('tolerates a missing map object', () => {
        const deps = makeDeps()
        deps.Map_.map = null
        const state = getViewState(deps)
        expect(state.center).toBe(null)
        expect(state.zoom).toBe(null)
    })
})
