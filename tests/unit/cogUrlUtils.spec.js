import { test, expect } from '@playwright/test'
import {
    processExpression,
    applyCogFieldsToUrl,
    isCogLayer,
    shouldUseDeckRaster,
} from '../../src/essence/Basics/Layers_/cogUrlUtils.ts'

test.describe('cogUrlUtils', () => {
    test.describe('processExpression', () => {
        test('returns empty string unchanged', () => {
            expect(processExpression('')).toBe('')
        })

        test('returns undefined/null unchanged', () => {
            expect(processExpression(undefined)).toBeUndefined()
            expect(processExpression(null)).toBeNull()
        })

        test('adds asset_ prefix to bare band references', () => {
            expect(processExpression('b1')).toBe('asset_b1')
            expect(processExpression('B2')).toBe('asset_B2')
        })

        test('handles expression with multiple band references', () => {
            expect(processExpression('b1/b2')).toBe('asset_b1/asset_b2')
        })

        test('does not double-prefix already-prefixed bands', () => {
            expect(processExpression('asset_b1')).toBe('asset_b1')
        })

        test('handles mixed prefixed and bare bands', () => {
            expect(processExpression('asset_b1+b2')).toBe('asset_b1+asset_b2')
        })
    })

    test.describe('applyCogFieldsToUrl', () => {
        test('returns url unchanged when no cog fields set', () => {
            const url = 'https://example.com/tiles/{z}/{x}/{y}'
            expect(applyCogFieldsToUrl(url, {})).toBe(url)
        })

        test('returns empty string unchanged', () => {
            expect(applyCogFieldsToUrl('', {})).toBe('')
        })

        test('appends colormap_name when cogColormap is set and cogTransform is true', () => {
            const result = applyCogFieldsToUrl('https://example.com/tiles/{z}/{x}/{y}', {
                cogTransform: true,
                cogColormap: 'viridis',
            })
            expect(result).toContain('colormap_name=viridis')
        })

        test('does not append colormap_name without cogTransform', () => {
            const result = applyCogFieldsToUrl('https://example.com/tiles/{z}/{x}/{y}', {
                cogColormap: 'viridis',
            })
            expect(result).not.toContain('colormap_name')
        })

        test('does not override existing colormap_name in url', () => {
            const url = 'https://example.com/tiles/{z}/{x}/{y}?colormap_name=plasma'
            const result = applyCogFieldsToUrl(url, { cogTransform: true, cogColormap: 'viridis' })
            expect(result).toContain('colormap_name=plasma')
            expect(result).not.toContain('colormap_name=viridis')
        })

        test('appends rescale when cogMin and cogMax are set and cogTransform is true', () => {
            const result = applyCogFieldsToUrl('https://example.com/tiles/{z}/{x}/{y}', {
                cogTransform: true,
                cogMin: 0,
                cogMax: 100,
            })
            expect(result).toContain('rescale=0%2C100')
        })

        test('does not append rescale without cogTransform', () => {
            const result = applyCogFieldsToUrl('https://example.com/tiles/{z}/{x}/{y}', {
                cogMin: 0,
                cogMax: 100,
            })
            expect(result).not.toContain('rescale')
        })

        test('does not override existing rescale in url', () => {
            const url = 'https://example.com/tiles/{z}/{x}/{y}?rescale=10,90'
            const result = applyCogFieldsToUrl(url, { cogTransform: true, cogMin: 0, cogMax: 100 })
            expect(result).toContain('rescale=10%2C90')
            expect(result).not.toContain('rescale=0%2C100')
        })

        test('prefers currentCogMin/Max over cogMin/Max', () => {
            const result = applyCogFieldsToUrl('https://example.com/tiles/{z}/{x}/{y}', {
                cogTransform: true,
                cogMin: 0,
                cogMax: 100,
                currentCogMin: 20,
                currentCogMax: 80,
            })
            expect(result).toContain('rescale=20%2C80')
        })

        test('expression takes precedence: removes bidx and sets expression', () => {
            const url = 'https://example.com/tiles/{z}/{x}/{y}?bidx=1'
            const result = applyCogFieldsToUrl(url, { cogExpression: 'b1/b2' })
            expect(result).not.toContain('bidx')
            expect(result).toContain('expression=asset_b1%2Fasset_b2')
        })

        test('prefers currentCogExpression over cogExpression', () => {
            const result = applyCogFieldsToUrl('https://example.com/tiles/{z}/{x}/{y}', {
                cogExpression: 'b1',
                currentCogExpression: 'b2',
            })
            expect(result).toContain('expression=asset_b2')
        })

        test('appends resampling when cogResampling is set', () => {
            const result = applyCogFieldsToUrl('https://example.com/tiles/{z}/{x}/{y}', {
                cogResampling: 'bilinear',
            })
            expect(result).toContain('resampling=bilinear')
        })
    })
})

test.describe('shouldUseDeckRaster', () => {
    test('true only for deckgl + COG + deckRaster mode', () => {
        const layer = { cogRendererMode: 'deckRaster' }
        expect(shouldUseDeckRaster('deckgl', 'COG', layer)).toBe(true)
    })
    test('false in leaflet even when mode is deckRaster', () => {
        expect(shouldUseDeckRaster('leaflet', 'COG', { cogRendererMode: 'deckRaster' })).toBe(false)
    })
    test('false when mode is titiler or unset', () => {
        expect(shouldUseDeckRaster('deckgl', 'COG', {})).toBe(false)
        expect(shouldUseDeckRaster('deckgl', 'COG', { cogRendererMode: 'titiler' })).toBe(false)
    })
    test('isCogLayer honors cogTransform and stac-collection', () => {
        expect(isCogLayer('stac-collection', {})).toBe(true)
        expect(isCogLayer(undefined, { cogTransform: true })).toBe(true)
        expect(isCogLayer('url', {})).toBe(false)
    })
    test('false for stac-collection even with deckRaster mode', () => {
        expect(shouldUseDeckRaster('deckgl', 'stac-collection', { cogRendererMode: 'deckRaster' })).toBe(false)
    })
})
