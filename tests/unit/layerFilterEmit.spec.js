// Contract spec for the plugin's one outbound broadcast: the event name, the
// payload shape (id-keyed selections in, UUIDs out), the id→property
// translation in front of the matcher, and the interaction gate on
// layers:setListed. This is the seam a replacement panel or a consumer
// plugin binds to — regressions here are invisible to helper-level tests.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { emitFilterChange } from '../../src/essence/Tools/LayerFilter/adapters/emitFilterChange.ts'

const LAYERS = {
    'uuid-flood': { properties: { theme: 'hazard', hazard: 'flood' } },
    'uuid-fire': { properties: { theme: 'hazard', hazard: 'fire' } },
    'uuid-header': { type: 'header' },
}

const FILTERS = [{ id: 'hazardFilter', property: 'hazard' }]

let emit, request
beforeEach(() => {
    emit = vi.fn()
    request = vi.fn().mockResolvedValue(true)
    window.mmgisAPI = { emit, request }
})
afterEach(() => {
    delete window.mmgisAPI
})

describe('emitFilterChange contract', () => {
    test('broadcasts plugin:layerfilter:changed with id-keyed selections and matched UUIDs', () => {
        const payload = emitFilterChange(
            'theme',
            'hazard',
            { hazardFilter: 'flood' },
            FILTERS,
            LAYERS,
            false,
        )
        expect(emit).toHaveBeenCalledExactlyOnceWith('plugin:layerfilter:changed', {
            themeId: 'hazard',
            selections: { hazardFilter: 'flood' },
            matchedLayerUUIDs: ['uuid-flood'],
        })
        expect(payload.matchedLayerUUIDs).toEqual(['uuid-flood'])
    })

    test('selections are translated filter-id → layer-property before matching', () => {
        // The selection key is the filter id, NOT the property name; a filter
        // id that shadowed a property name used to mask this seam.
        const { matchedLayerUUIDs } = emitFilterChange(
            'theme',
            'hazard',
            { hazardFilter: 'fire' },
            FILTERS,
            LAYERS,
            false,
        )
        expect(matchedLayerUUIDs).toEqual(['uuid-fire'])
    })

    test('does not touch the layers list before first interaction', () => {
        emitFilterChange('theme', 'hazard', {}, FILTERS, LAYERS, false)
        expect(request).not.toHaveBeenCalled()
    })

    test('applies the full listed-flag complement after interaction, headers skipped', () => {
        emitFilterChange('theme', 'hazard', { hazardFilter: 'flood' }, FILTERS, LAYERS, true)
        expect(request).toHaveBeenCalledExactlyOnceWith('layers:setListed', {
            updates: { 'uuid-flood': true, 'uuid-fire': false },
            source: 'layerfilter',
        })
    })
})
