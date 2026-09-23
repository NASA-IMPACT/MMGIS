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

describe('vectorTileHighlightOptions highlight colour', () => {
    test('turns a configured colour into the channels deck wants', () => {
        const o = vectorTileHighlightOptions({
            hoverHighlight: true,
            vtId: 'fid',
            hoverHighlightColor: '#ff0000',
        })
        expect(o.highlightColor).toEqual([255, 0, 0, 255])
    })

    test('takes the opacity from the colour itself, as the picker writes it', () => {
        const o = vectorTileHighlightOptions({
            hoverHighlight: true,
            hoverHighlightColor: 'rgba(255, 0, 0, 0.5)',
        })
        expect(o.highlightColor).toEqual([255, 0, 0, 128])
    })

    test('reads a plain hex as fully opaque', () => {
        const o = vectorTileHighlightOptions({ hoverHighlightColor: '#00ff00' })
        expect(o.highlightColor).toEqual([0, 255, 0, 255])
    })

    test('leaves the colour to deck when the mission chose none', () => {
        const o = vectorTileHighlightOptions({ hoverHighlight: true, vtId: 'fid' })
        expect('highlightColor' in o).toBe(false)
    })

    test('leaves the colour to deck when the field holds nothing usable', () => {
        const o = vectorTileHighlightOptions({
            hoverHighlight: true,
            hoverHighlightColor: '   ',
        })
        expect('highlightColor' in o).toBe(false)
    })

    test('leaves a fully transparent colour to deck, which the color helper cannot tell from garbage', () => {
        // A highlight nobody can see is what the switch above it is for.
        const o = vectorTileHighlightOptions({
            hoverHighlightColor: 'rgba(255, 0, 0, 0)',
        })
        expect('highlightColor' in o).toBe(false)
    })
})

test('leaves the colour to deck when the configured one cannot be read', () => {
    // The helper answers a white fallback for an unreadable colour, and an
    // opaque white nobody chose is worse than deck's own default.
    const o = vectorTileHighlightOptions({
        hoverHighlight: true,
        hoverHighlightColor: 'not a colour',
    })
    expect('highlightColor' in o).toBe(false)
})
