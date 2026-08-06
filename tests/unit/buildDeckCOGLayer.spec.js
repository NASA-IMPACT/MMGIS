import { test, expect, describe } from 'vitest'
import {
    buildDeckCOGLayer,
    resolveNoDataValue,
} from '../../src/essence/Basics/MapEngines/Adapters/DeckCOGLayer.ts'

describe('buildDeckCOGLayer', () => {
    test('derives zoom limits from the layer config so refresh rebuilds keep them', () => {
        const layer = buildDeckCOGLayer('l1', {
            rawCogUrl: 'https://example.com/a.tif',
            layerObj: { minZoom: '3', maxZoom: '12', cogColormap: 'viridis' },
        })
        expect(layer.props.minZoom).toBe(3)
        expect(layer.props.maxZoom).toBe(12)
    })

    test('leaves zoom limits at deck defaults (not NaN) when the config has none', () => {
        const layer = buildDeckCOGLayer('l2', {
            rawCogUrl: 'https://example.com/a.tif',
            layerObj: {},
        })
        expect(Number.isNaN(layer.props.minZoom)).toBe(false)
        expect(Number.isNaN(layer.props.maxZoom)).toBe(false)
    })

    test('supplies getTileData and renderTile together (skips float-unsupported inference)', () => {
        const layer = buildDeckCOGLayer('l3', {
            rawCogUrl: 'https://example.com/a.tif',
            layerObj: {},
        })
        expect(typeof layer.props.getTileData).toBe('function')
        expect(typeof layer.props.renderTile).toBe('function')
    })

    test('re-renders without refetching when colormap or rescale changes', () => {
        const layer = buildDeckCOGLayer('l4', {
            rawCogUrl: 'https://example.com/a.tif',
            layerObj: { cogColormap: 'plasma', cogMin: 0, cogMax: 10 },
        })
        // renderTile carries the trigger; getTileData deliberately does not, so
        // cached tiles survive a colormap change.
        expect(layer.props.updateTriggers.renderTile).toEqual(['plasma', 0, 10])
        expect(layer.props.updateTriggers.getTileData).toBeUndefined()
    })

    describe('renderTile', () => {
        const renderTileOf = (layerObj = {}) =>
            buildDeckCOGLayer('r', {
                rawCogUrl: 'https://example.com/a.tif',
                layerObj,
            }).props.renderTile

        test('skips a tile with no data', () => {
            expect(renderTileOf()(null)).toBe(null)
        })

        test('multi-band tiles display colour directly and discard black nodata', () => {
            const texture = { device: {} }
            const result = renderTileOf()({
                texture,
                mode: 'rgb',
                width: 8,
                height: 8,
                byteLength: 256,
            })
            const names = result.renderPipeline.map((m) => m.module.name)
            expect(names).toEqual(['create-texture-unorm', 'filter-black'])
            expect(result.renderPipeline[0].props.textureName).toBe(texture)
        })
    })
})

describe('resolveNoDataValue', () => {
    test("falls back to the file's GDAL_NODATA when no config value is set", () => {
        expect(resolveNoDataValue(null, -9999)).toBe(-9999)
        expect(resolveNoDataValue(undefined, 0)).toBe(0)
    })

    test('config value wins over the file value', () => {
        expect(resolveNoDataValue(255, -9999)).toBe(255)
    })

    test('returns null when neither is set', () => {
        expect(resolveNoDataValue(null, null)).toBe(null)
        expect(resolveNoDataValue(undefined, undefined)).toBe(null)
    })

    test('returns null for NaN — FilterNaN discards those pixels, == cannot match them', () => {
        expect(resolveNoDataValue(null, NaN)).toBe(null)
        expect(resolveNoDataValue(NaN, -9999)).toBe(null)
    })
})
