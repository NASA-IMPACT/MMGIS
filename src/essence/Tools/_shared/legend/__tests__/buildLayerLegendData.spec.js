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

    // populateCogScale also runs for velocity layers, which core reports no
    // colormap for. With no live cog data to prefer, the derived `_legend` is
    // the only legend the layer has, so it renders rather than being dropped.
    test('renders an auto-generated _legend when there is no cog', () => {
        const legend = [
            { shape: 'continuous', color: '#000000', value: '0 m/s' },
            { shape: 'continuous', color: '#ffffff', value: '10 m/s' },
        ]
        const cfg = { _legend: legend, _legendAutoGenerated: true }
        const result = buildLayerLegendData('layer17', cfg, null, true, NO_COG)
        expect(result.cog).toBeNull()
        expect(result.type).toBe('gradient')
        expect(result.stops).toEqual(['#000000', '#ffffff'])
        expect(result.min).toBe(0)
        expect(result.max).toBe(10)
        expect(result.unit).toEqual({ label: 'm/s' })
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

    // A purely numeric value must never invent a unit out of its own digits:
    // an unanchored numeric match backtracks into '-0.1' and reads '1' as the
    // unit.
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

    // The mixed form documented in docs/pages/Tools/Legend/Legend.md: runs of
    // discreet/continuous entries interleaved with individually shaped
    // circle/square/rect ones, all labelled with words. Deciding the type from
    // the first entry's shape alone would make the whole thing one gradient,
    // labelled with two of those words as its bounds.
    test('renders a mixed shape legend as swatches, not one gradient', () => {
        const legend = [
            { color: 'purple', shape: 'discreet', value: 'This' },
            { color: 'cyan', shape: 'discreet', value: 'is' },
            { color: 'purple', shape: 'continuous', value: 'what' },
            { color: 'pink', shape: 'circle', value: 'csv' },
            { color: 'crimson', shape: 'square', value: 'possibly' },
            { color: 'indigo', shape: 'rect', value: 'contain' },
        ]
        const result = buildLayerLegendData('layer18', { _legend: legend }, null, true, NO_COG)
        expect(result.type).toBe('categorical')
        expect(result.categoricalStops.map((s) => s.label)).toEqual([
            'This', 'is', 'what', 'csv', 'possibly', 'contain',
        ])
        expect(result.stops).toBeUndefined()
    })

    // Every entry is a scale shape, but the values are words — there is no
    // range to draw, so the bar would be labelled with two stray words.
    test('renders a scale legend with word values as swatches', () => {
        const legend = [
            { color: 'purple', shape: 'discreet', value: 'low' },
            { color: 'red', shape: 'discreet', value: 'high' },
        ]
        const result = buildLayerLegendData('layer19', { _legend: legend }, null, true, NO_COG)
        expect(result.type).toBe('categorical')
        expect(result.min).toBeUndefined()
        expect(result.max).toBeUndefined()
    })

    // Binned labels parse to a number followed by the rest of the bin, which
    // is not a unit — '0.5-1.0 m' must not yield the unit '-1.0 m'.
    test('renders binned scale labels as swatches rather than inventing a unit', () => {
        const legend = [
            { color: '#111111', shape: 'discreet', value: '0.0-0.5 m' },
            { color: '#222222', shape: 'discreet', value: '0.5-1.0 m' },
        ]
        const result = buildLayerLegendData('layer20', { _legend: legend }, null, true, NO_COG)
        expect(result.type).toBe('categorical')
        expect(result.unit).toBeUndefined()
        expect(result.categoricalStops.map((s) => s.label)).toEqual([
            '0.0-0.5 m',
            '0.5-1.0 m',
        ])
    })

    // The gradient path filters hidden entries the same way the categorical
    // one does; an author-hidden nodata colour is not a ramp stop, and its
    // value is not a bound.
    test('filters hidden entries out of a gradient ramp', () => {
        const legend = [
            { shape: 'continuous', color: '#000000', value: '0 m' },
            { shape: 'continuous', color: '#ffffff', value: '100 m' },
            { shape: 'continuous', color: '#ff00ff', value: '-9999 m', hideFromLegend: true },
        ]
        const result = buildLayerLegendData('layer21', { _legend: legend }, null, true, NO_COG)
        expect(result.type).toBe('gradient')
        expect(result.stops).toEqual(['#000000', '#ffffff'])
        expect(result.min).toBe(0)
        expect(result.max).toBe(100)
    })

    // Every entry hidden leaves nothing to draw — the layer falls through to
    // whatever the cog block offers, exactly as an absent legend does.
    test('an all-hidden legend is treated as no legend', () => {
        const legend = [
            { color: '#ff0000', value: 'water', hideFromLegend: true },
        ]
        expect(
            buildLayerLegendData('layer22', { _legend: legend }, null, true, NO_COG).type,
        ).toBe('none')
    })

    // A class keyed 0 is a real label, so the fallback to `label` has to test
    // for undefined rather than for truthiness.
    test('keeps a categorical value of 0 as its label', () => {
        const legend = [
            { color: '#ff0000', value: 0 },
            { color: '#00ff00', value: 1 },
        ]
        const result = buildLayerLegendData('layer23', { _legend: legend }, null, true, NO_COG)
        expect(result.categoricalStops).toEqual([
            { color: '#ff0000', label: '0' },
            { color: '#00ff00', label: '1' },
        ])
    })

    test('falls back to the label when an entry has no value', () => {
        const legend = [{ color: '#ff0000', label: 'water' }]
        const result = buildLayerLegendData('layer24', { _legend: legend }, null, true, NO_COG)
        expect(result.categoricalStops).toEqual([
            { color: '#ff0000', label: 'water' },
        ])
    })

    // An unrescaled raster has no bounds to report; 0 and 255 would print on
    // the export as an authoritative range the layer was never rescaled to.
    test('leaves COG bounds null when the mission configures none', () => {
        const result = buildLayerLegendData(
            'layer25', { cogColormap: 'viridis' }, null, true, EDITABLE_COG,
        )
        expect(result.cog?.min).toBeNull()
        expect(result.cog?.max).toBeNull()
        expect(result.type).toBe('gradient')
        expect(result.min).toBeNull()
        expect(result.max).toBeNull()
    })

    test('keeps configured COG bounds as they are', () => {
        const cfg = { cogColormap: 'viridis', cogMin: -2, cogMax: 6 }
        const result = buildLayerLegendData('layer26', cfg, null, true, EDITABLE_COG)
        expect(result.cog?.min).toBe(-2)
        expect(result.cog?.max).toBe(6)
    })
})
