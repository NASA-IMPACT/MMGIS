import { describe, test, expect } from 'vitest'

import { vectorTileHighlightOptions } from '../../src/essence/Basics/Layers_/deckVectorTileHighlight'

/**
 * deck's MVTLayer does its own highlighting: it disables autoHighlight on the
 * sub-layers it renders and instead resolves the hovered feature through
 * `uniqueIdProperty`. With no such property the lookup answers undefined and
 * nothing highlights, however the layer is configured — so the mission's
 * chosen id key has to reach the layer for the checkbox to mean anything.
 */
describe('vectorTileHighlightOptions', () => {
    test('carries the mission\'s unique id key to deck', () => {
        expect(
            vectorTileHighlightOptions({ hoverHighlight: true, vtId: 'fid' })
        ).toEqual({ autoHighlight: true, uniqueIdProperty: 'fid' })
    })

    test('leaves highlighting off when the mission did not ask for it', () => {
        expect(
            vectorTileHighlightOptions({ vtId: 'fid' })
        ).toEqual({ autoHighlight: false, uniqueIdProperty: 'fid' })
    })

    test('answers an empty id key as none, which is how an untouched field reads', () => {
        expect(
            vectorTileHighlightOptions({ hoverHighlight: true, vtId: '' })
        ).toEqual({ autoHighlight: true, uniqueIdProperty: undefined })
    })

    test('trims an id key, since the field is free text', () => {
        expect(
            vectorTileHighlightOptions({ hoverHighlight: true, vtId: ' fid ' })
        ).toEqual({ autoHighlight: true, uniqueIdProperty: 'fid' })
    })

    test('survives a layer with no style at all', () => {
        expect(vectorTileHighlightOptions(undefined)).toEqual({
            autoHighlight: false,
            uniqueIdProperty: undefined,
        })
    })
})
