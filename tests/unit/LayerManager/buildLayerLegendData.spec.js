import { test, expect } from 'vitest'
import { buildLayerLegendData } from '../../../src/essence/Tools/LayerManager/adapters/buildLayerLegendData.ts'

test.describe('buildLayerLegendData', () => {
    test('returns text type for layer with no legend and no COG', () => {
        const result = buildLayerLegendData('layer1', { display_name: 'L1' }, null, true, false)
        expect(result.id).toBe('layer1')
        expect(result.title).toBe('L1')
        expect(result.type).toBe('none')
        expect(result.cog).toBeNull()
        expect(result.visible).toBe(true)
    })

    test('builds gradient legend from continuous shape', () => {
        const legend = [
            { shape: 'continuous', color: '#000000', value: '0 m' },
            { shape: 'continuous', color: '#ffffff', value: '100 m' },
        ]
        const result = buildLayerLegendData('layer2', { _legend: legend }, { layer2: 0.5 }, true, false)
        expect(result.type).toBe('gradient')
        expect(result.stops).toEqual(['#000000', '#ffffff'])
        expect(result.min).toBe(0)
        expect(result.max).toBe(100)
        expect(result.unit).toEqual({ label: 'm' })
        expect(result.opacity).toBe(0.5)
    })

    test('builds categorical legend and filters hidden entries', () => {
        const legend = [
            { color: '#ff0000', value: 'water' },
            { color: '#00ff00', value: 'land', hideFromLegend: true },
            { color: '#0000ff', value: 'sky' },
        ]
        const result = buildLayerLegendData('layer3', { _legend: legend }, null, true, false)
        expect(result.type).toBe('categorical')
        expect(result.categoricalStops).toEqual([
            { color: '#ff0000', label: 'water' },
            { color: '#0000ff', label: 'sky' },
        ])
    })

    test('produces COG metadata for a colormap-capable layer', () => {
        const cfg = {
            cogColormap: 'plasma',
            cogMin: 0,
            cogMax: 1000,
            cogUnits: 'm',
            titilerUrl: 'https://example.com/titiler',
        }
        const result = buildLayerLegendData('layer4', cfg, null, true, true)
        expect(result.cog).not.toBeNull()
        expect(result.cog?.titilerUrl).toBe('https://example.com/titiler')
        expect(result.cog?.colormap).toBe('plasma')
        expect(result.cog?.defaultMin).toBe(0)
        expect(result.cog?.defaultMax).toBe(1000)
        expect(result.type).toBe('gradient')
        expect(result.stops).toBeNull()
    })

    test('prefers the current colormap and rescale over the configured ones', () => {
        const cfg = {
            cogColormap: 'viridis',
            cogMin: 0,
            cogMax: 1,
            currentCogColormap: 'rdbu_r',
            currentCogMin: -0.1,
            currentCogMax: 0.2,
        }
        const result = buildLayerLegendData('layer5', cfg, null, true, true)
        expect(result.cog?.colormap).toBe('rdbu_r')
        expect(result.cog?.min).toBe(-0.1)
        expect(result.cog?.max).toBe(0.2)
        // The defaults stay pinned to the mission config so the control can
        // offer a reset.
        expect(result.cog?.defaultColormap).toBe('viridis')
        expect(result.cog?.defaultMin).toBe(0)
        expect(result.cog?.defaultMax).toBe(1)
    })

    test('keeps a legend gradient when the layer is not colormap-capable', () => {
        const legend = [
            { shape: 'continuous', color: '#000000', value: '0' },
            { shape: 'continuous', color: '#ffffff', value: '10' },
        ]
        const cfg = { _legend: legend, cogColormap: 'viridis' }
        const result = buildLayerLegendData('layer6', cfg, null, true, false)
        expect(result.type).toBe('gradient')
        expect(result.cog).toBeNull()
    })

    test('leaves a layer without COG metadata when core reports it incapable', () => {
        const cfg = { cogColormap: 'viridis', cogMin: 0, cogMax: 1 }
        const result = buildLayerLegendData('layer7', cfg, null, true, false)
        expect(result.cog).toBeNull()
        expect(result.type).toBe('none')
    })
})
