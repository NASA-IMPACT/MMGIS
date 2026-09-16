import { test, expect, describe } from 'vitest'
const config = require('../../configure/src/metaconfigs/layer-tile-config.json')

function findField(cfg, fieldName) {
    for (const tab of cfg.tabs || []) {
        for (const row of tab.rows || []) {
            for (const comp of row.components || []) {
                if (comp.field === fieldName) return { tab: tab.name, comp }
            }
        }
    }
    return null
}

test('cogRendererMode lives on the COG tab with titiler/deckRaster options', () => {
    const found = findField(config, 'cogRendererMode')
    expect(found).not.toBeNull()
    expect(found.tab).toBe('COG')
    expect(found.comp.type).toBe('dropdown')
    expect(found.comp.options).toEqual(['titiler', 'deckRaster'])
    expect(found.comp.default).toBe('titiler')
})
