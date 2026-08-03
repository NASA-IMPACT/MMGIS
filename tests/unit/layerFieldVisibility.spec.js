import { test, expect, describe } from 'vitest'
import {
    getHiddenFieldsForEngine,
    stripHiddenFields,
} from '../../configure/src/components/Tabs/Layers/Modals/LayerModal/layerFieldVisibility.js'

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
