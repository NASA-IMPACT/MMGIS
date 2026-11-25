import { test, expect, describe } from 'vitest'
import {
    getHiddenFieldsForEngine,
    stripHiddenFields,
} from '../../configure/src/components/Tabs/Layers/Modals/LayerModal/layerFieldVisibility.js'
import vectortileConfig from '../../configure/src/metaconfigs/layer-vectortile-config.json'
import vectorConfig from '../../configure/src/metaconfigs/layer-vector-config.json'

const sample = () => ({
    tabs: [
        { name: 'COG', rows: [
            { components: [
                { field: 'cogColormap', type: 'colordropdown' },
                { field: 'cogRendererMode', type: 'dropdown' },
            ] },
            { components: [{ field: 'cogRendererMode', type: 'dropdown' }] },
        ] },
    ],
})

test('leaflet hides cogRendererMode and drops the now-empty row', () => {
    const hidden = getHiddenFieldsForEngine('leaflet', 'tile')
    expect(hidden.has('cogRendererMode')).toBe(true)
    const out = stripHiddenFields(sample(), hidden)
    const cog = out.tabs.find((t) => t.name === 'COG')
    expect(cog.rows.length).toBe(1)
    const fields = cog.rows[0].components.map((c) => c.field)
    expect(fields).toEqual(['cogColormap'])
})

test('deckgl keeps cogRendererMode', () => {
    const hidden = getHiddenFieldsForEngine('deckgl', 'tile')
    expect(hidden.has('cogRendererMode')).toBe(false)
    const out = stripHiddenFields(sample(), hidden)
    const cog = out.tabs.find((t) => t.name === 'COG')
    const fields = cog.rows.flatMap((r) => r.components.map((c) => c.field))
    expect(fields).toContain('cogRendererMode')
})

const withFeaturePopup = () => ({
    tabs: [
        { name: 'Interface', rows: [
            { components: [
                { field: 'variables.useKeyAsName.0', type: 'text' },
                { field: 'variables.featurePopup.enabled', type: 'checkbox' },
            ] },
            { components: [
                { field: 'variables.featurePopup.title', type: 'text' },
                { field: 'variables.featurePopup.properties', type: 'textarray' },
                { field: 'variables.featurePopup.actions', type: 'objectarray' },
            ] },
        ] },
    ],
})

test('leaflet hides the feature popup fields, which only deck.gl acts on', () => {
    const hidden = getHiddenFieldsForEngine('leaflet', 'vectortile')
    const out = stripHiddenFields(withFeaturePopup(), hidden)
    const fields = out.tabs[0].rows.flatMap((r) => r.components.map((c) => c.field))

    expect(fields).toEqual(['variables.useKeyAsName.0'])
})

test('deckgl keeps the feature popup fields', () => {
    const hidden = getHiddenFieldsForEngine('deckgl', 'vectortile')
    const out = stripHiddenFields(withFeaturePopup(), hidden)
    const fields = out.tabs[0].rows.flatMap((r) => r.components.map((c) => c.field))

    expect(fields).toContain('variables.featurePopup.enabled')
    expect(fields).toContain('variables.featurePopup.actions')
})

const withHoverHighlight = () => ({
    tabs: [
        { name: 'Style', rows: [
            { components: [
                { field: 'style.vtId', type: 'text' },
                { field: 'style.hoverHighlight', type: 'checkbox' },
                { field: 'style.hoverHighlightColor', type: 'colorpicker' },
            ] },
        ] },
    ],
})

test('leaflet hides the hover highlight fields, which only deck.gl reads', () => {
    const hidden = getHiddenFieldsForEngine('leaflet', 'vectortile')
    const out = stripHiddenFields(withHoverHighlight(), hidden)
    const fields = out.tabs[0].rows.flatMap((r) => r.components.map((c) => c.field))

    // The id key stays: Leaflet reads it too, as its own feature id.
    expect(fields).toEqual(['style.vtId'])
})

test('deckgl keeps the hover highlight fields', () => {
    const hidden = getHiddenFieldsForEngine('deckgl', 'vectortile')
    const out = stripHiddenFields(withHoverHighlight(), hidden)
    const fields = out.tabs[0].rows.flatMap((r) => r.components.map((c) => c.field))

    expect(fields).toContain('style.hoverHighlight')
    expect(fields).toContain('style.hoverHighlightColor')
})

// Leaflet draws vector tiles through a plugin that ignores Color by Value, so
// its fields are absent there; Leaflet vector (GeoJSON) layers do read it.
describe('Color by Value fields', () => {
    const colorByFields = (config, engine, type) =>
        stripHiddenFields(config, getHiddenFieldsForEngine(engine, type))
            .tabs.flatMap((t) => t.rows)
            .flatMap((r) => r.components.map((c) => c.field))
            .filter((f) => f?.startsWith('style.colorBy'))

    test.each([['vectortile'], ['MVTLayer']])(
        'leaflet hides every one of them on a %s layer',
        (type) => {
            expect(colorByFields(vectortileConfig, 'leaflet', type)).toEqual([])
        }
    )

    test('deckgl keeps them on a vector tile layer', () => {
        expect(colorByFields(vectortileConfig, 'deckgl', 'MVTLayer')).toHaveLength(8)
    })

    test('leaflet keeps them on a vector layer', () => {
        expect(colorByFields(vectorConfig, 'leaflet', 'vector')).toHaveLength(8)
    })
})
