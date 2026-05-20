import { test, expect } from '@playwright/test'
import { buildLayerLegendData } from '../../../src/essence/Tools/LayerManager/adapters/buildLayerLegendData.ts'

test.describe('buildLayerLegendData', () => {
    test('returns text type for layer with no legend and no COG', () => {
        const result = buildLayerLegendData('layer1', { type: 'vector', display_name: 'L1' }, null, true)
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
        const result = buildLayerLegendData('layer2', { type: 'tile', _legend: legend }, { layer2: 0.5 }, true)
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
        const result = buildLayerLegendData('layer3', { type: 'vector', _legend: legend }, null, true)
        expect(result.type).toBe('categorical')
        expect(result.categoricalStops).toEqual([
            { color: '#ff0000', label: 'water' },
            { color: '#0000ff', label: 'sky' },
        ])
    })

    test('produces COG metadata for tile layer with cogTransform', () => {
        const cfg = {
            type: 'tile',
            cogTransform: true,
            cogColormap: 'plasma',
            cogMin: 0,
            cogMax: 1000,
            cogUnits: 'm',
            titilerUrl: 'https://example.com/titiler',
        }
        const result = buildLayerLegendData('layer4', cfg, null, true)
        expect(result.cog).not.toBeNull()
        expect(result.cog?.titilerUrl).toBe('https://example.com/titiler')
        expect(result.cog?.colormap).toBe('plasma')
        expect(result.cog?.defaultMin).toBe(0)
        expect(result.cog?.defaultMax).toBe(1000)
        expect(result.type).toBe('gradient')
        expect(result.stops).toBeNull()
    })
})
