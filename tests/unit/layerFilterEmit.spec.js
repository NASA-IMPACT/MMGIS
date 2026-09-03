// Contract spec for the plugin's one outbound broadcast: the event name, the
// payload shape (id-keyed selections in, UUIDs out), and the interaction gate
// on layers:setListed. Matching itself is the engine's job (layerFilterEngine
// spec) — this seam receives the engine's surviving layer keys. This is what
// a replacement panel or a consumer plugin binds to — regressions here are
// invisible to helper-level tests.
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { emitFilterChange } from '../../src/essence/Tools/LayerFilter/adapters/emitFilterChange.ts'

const LAYERS = {
    'uuid-flood': { properties: { theme: 'hazard', hazard: 'flood' } },
    'uuid-fire': { properties: { theme: 'hazard', hazard: 'fire' } },
    'uuid-header': { type: 'header' },
}

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
            'hazard',
            { hazardFilter: 'flood' },
            ['uuid-flood'],
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

    test('does not touch the layers list before first interaction', () => {
        emitFilterChange('hazard', {}, ['uuid-flood', 'uuid-fire'], LAYERS, false)
        expect(request).not.toHaveBeenCalled()
    })

    test('applies the full listed-flag complement after interaction, headers skipped', () => {
        emitFilterChange('hazard', { hazardFilter: 'flood' }, ['uuid-flood'], LAYERS, true)
        expect(request).toHaveBeenCalledExactlyOnceWith(
            'layers:setListed',
            {
                updates: { 'uuid-flood': true, 'uuid-fire': false },
                source: 'layerfilter',
            },
            undefined
        )
    })
})
