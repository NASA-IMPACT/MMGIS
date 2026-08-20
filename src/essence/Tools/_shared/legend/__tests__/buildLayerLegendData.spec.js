import { test, expect } from 'vitest'
import { buildLayerLegendData } from '../buildLayerLegendData.ts'

// The three verdicts core can return for a layer. A colormap that can be
// shown but not changed is what an `image` layer reports: it paints from the
// same cog* fields, but bakes them in at construction.
const NO_COG = { hasColormap: false, canChangeColormap: false }
const EDITABLE_COG = { hasColormap: true, canChangeColormap: true }
const READ_ONLY_COG = { hasColormap: true, canChangeColormap: false }

test.describe('buildLayerLegendData', () => {
    test('returns text type for layer with no legend and no COG', () => {
        const result = buildLayerLegendData('layer1', { display_name: 'L1' }, null, true, NO_COG)
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
        const result = buildLayerLegendData('layer2', { _legend: legend }, { layer2: 0.5 }, true, NO_COG)
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
        const result = buildLayerLegendData('layer3', { _legend: legend }, null, true, NO_COG)
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
        }
        const result = buildLayerLegendData(
            'layer4', cfg, null, true, EDITABLE_COG, 'https://example.com/titiler',
        )
        expect(result.cog).not.toBeNull()
        expect(result.cog?.titilerUrl).toBe('https://example.com/titiler')
        expect(result.cog?.colormap).toBe('plasma')
        expect(result.cog?.defaultMin).toBe(0)
        expect(result.cog?.defaultMax).toBe(1000)
        expect(result.cog?.editable).toBe(true)
        expect(result.type).toBe('gradient')
        expect(result.stops).toBeNull()
    })

    // Core's answer already accounts for the mission-wide override, so a raw
    // config read would disagree with the service the tiles are drawn from.
    test('takes the service URL from core, not from the raw layer config', () => {
        const cfg = { cogColormap: 'plasma', titilerUrl: 'https://from-config.test' }
        const result = buildLayerLegendData(
            'layer4b', cfg, null, true, EDITABLE_COG, 'https://from-core.test',
        )
        expect(result.cog?.titilerUrl).toBe('https://from-core.test')
    })

    test('leaves the service URL null when core resolves none', () => {
        const cfg = { cogColormap: 'plasma' }
        const result = buildLayerLegendData('layer4c', cfg, null, true, EDITABLE_COG)
        expect(result.cog?.titilerUrl).toBeNull()
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
        const result = buildLayerLegendData('layer5', cfg, null, true, EDITABLE_COG)
        expect(result.cog?.colormap).toBe('rdbu_r')
        expect(result.cog?.min).toBe(-0.1)
        expect(result.cog?.max).toBe(0.2)
        // The defaults stay pinned to the mission config so the control can
        // offer a reset.
        expect(result.cog?.defaultColormap).toBe('viridis')
        expect(result.cog?.defaultMin).toBe(0)
        expect(result.cog?.defaultMax).toBe(1)
    })

    // The common shape for a mission raster: a configured legend AND a COG
    // colormap. The legend decides how the bar is drawn; the COG block has to
    // survive that branch or the layer silently loses its colormap controls.
    test('keeps COG metadata for a capable layer that also has a legend', () => {
        const legend = [
            { shape: 'continuous', color: '#000000', value: '0 m' },
            { shape: 'continuous', color: '#ffffff', value: '10 m' },
        ]
        const cfg = { _legend: legend, cogColormap: 'viridis', cogMin: 0, cogMax: 10 }
        const result = buildLayerLegendData('layer6', cfg, null, true, EDITABLE_COG)
        expect(result.type).toBe('gradient')
        expect(result.stops).toEqual(['#000000', '#ffffff'])
        expect(result.cog).not.toBeNull()
        expect(result.cog?.editable).toBe(true)
    })

    // populateCogScale (LayersTool) writes its derived colormap snapshot into
    // the same `_legend` field an authored legend uses, marking it with
    // `_legendAutoGenerated`. That marker must make it lose to the live cog
    // block rather than being treated as authored.
    test('an auto-generated _legend defers to the live cog bar', () => {
        const legend = [
            { shape: 'continuous', color: '#000000', value: '0 m' },
            { shape: 'continuous', color: '#ffffff', value: '10 m' },
        ]
        const cfg = {
            _legend: legend,
            _legendAutoGenerated: true,
            cogColormap: 'viridis',
            cogMin: 2,
            cogMax: 8,
            cogUnits: 'K',
        }
        const result = buildLayerLegendData('layer12', cfg, null, true, EDITABLE_COG)
        expect(result.type).toBe('gradient')
        expect(result.stops).toBeNull()
        expect(result.min).toBe(2)
        expect(result.max).toBe(8)
        expect(result.unit).toEqual({ label: 'K' })
        expect(result.cog).not.toBeNull()
        expect(result.cog?.colormap).toBe('viridis')
    })

    test('keeps COG metadata for a capable layer with a categorical legend', () => {
        const legend = [
            { color: '#ff0000', value: 'water' },
            { color: '#0000ff', value: 'sky' },
        ]
        const cfg = { _legend: legend, cogColormap: 'viridis' }
        const result = buildLayerLegendData('layer7', cfg, null, true, EDITABLE_COG)
        expect(result.type).toBe('categorical')
        expect(result.cog).not.toBeNull()
    })

    // An `image` layer: the ramp and its bounds are shown, but nothing offers
    // to change them.
    test('marks a showable but unchangeable colormap uneditable', () => {
        const cfg = { cogColormap: 'viridis', cogMin: 0, cogMax: 4000, cogUnits: 'm' }
        const result = buildLayerLegendData('layer8', cfg, null, true, READ_ONLY_COG)
        expect(result.cog).not.toBeNull()
        expect(result.cog?.editable).toBe(false)
        expect(result.cog?.colormap).toBe('viridis')
        // The gradient bar still draws, over the COG bounds.
        expect(result.type).toBe('gradient')
        expect(result.min).toBe(0)
        expect(result.max).toBe(4000)
        expect(result.unit).toEqual({ label: 'm' })
    })

    test('keeps a legend gradient when the layer has no COG colormap', () => {
        const legend = [
            { shape: 'continuous', color: '#000000', value: '0' },
            { shape: 'continuous', color: '#ffffff', value: '10' },
        ]
        const cfg = { _legend: legend, cogColormap: 'viridis' }
        const result = buildLayerLegendData('layer9', cfg, null, true, NO_COG)
        expect(result.type).toBe('gradient')
        expect(result.cog).toBeNull()
    })

    test('leaves a layer without COG metadata when core reports none', () => {
        const cfg = { cogColormap: 'viridis', cogMin: 0, cogMax: 1 }
        const result = buildLayerLegendData('layer10', cfg, null, true, NO_COG)
        expect(result.cog).toBeNull()
        expect(result.type).toBe('none')
    })

    // Core without the handler answers null rather than a verdict; that must
    // read as "no COG", not throw.
    test('leaves a layer without COG metadata when core answers nothing', () => {
        const cfg = { cogColormap: 'viridis', cogMin: 0, cogMax: 1 }
        expect(buildLayerLegendData('layer11', cfg, null, true, null).cog).toBeNull()
        expect(buildLayerLegendData('layer11', cfg, null, true, undefined).cog).toBeNull()
    })

    // A purely numeric value must never invent a unit out of its own digits
    // (the old [\d.]+\s*(.+) regex backtracked into '-0.1' and captured '1').
    test('derives no unit from a negative decimal value', () => {
        const legend = [
            { shape: 'continuous', color: '#000000', value: '-0.1' },
            { shape: 'continuous', color: '#ffffff', value: '1' },
        ]
        const result = buildLayerLegendData('layer13', { _legend: legend }, null, true, NO_COG)
        expect(result.unit).toBeNull()
    })

    test('derives a unit from a decimal value with a suffix', () => {
        const legend = [
            { shape: 'continuous', color: '#000000', value: '0.5 ppm' },
            { shape: 'continuous', color: '#ffffff', value: '1 ppm' },
        ]
        const result = buildLayerLegendData('layer14', { _legend: legend }, null, true, NO_COG)
        expect(result.unit).toEqual({ label: 'ppm' })
    })

    test('derives a unit from a signed exponent value with a suffix', () => {
        const legend = [
            { shape: 'continuous', color: '#000000', value: '-3e2 m' },
            { shape: 'continuous', color: '#ffffff', value: '1e2 m' },
        ]
        const result = buildLayerLegendData('layer15', { _legend: legend }, null, true, NO_COG)
        expect(result.unit).toEqual({ label: 'm' })
    })

    test('derives no unit from a plain integer value', () => {
        const legend = [
            { shape: 'continuous', color: '#000000', value: '10' },
            { shape: 'continuous', color: '#ffffff', value: '20' },
        ]
        const result = buildLayerLegendData('layer16', { _legend: legend }, null, true, NO_COG)
        expect(result.unit).toBeNull()
    })
})
