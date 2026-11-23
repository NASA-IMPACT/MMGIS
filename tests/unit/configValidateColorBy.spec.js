import { describe, test, expect } from 'vitest'
import validate from '../../API/Backend/Config/validate.js'

/**
 * A Color by Value setting the map cannot draw is refused when the mission is
 * saved, with a reason Configure shows the author, rather than saved and drawn
 * in every feature's fixed color.
 */

const reasons = (colorBy, type = 'GeoJsonLayer') => {
    const layer = { name: 'Layer', uuid: 'a', type, url: 'x', style: { colorBy } }
    const result = validate({ msv: {}, tools: [], layers: [layer] })
    return (result.errors || []).map((e) => e.reason)
}

const colormap = { mode: 'colormap', property: 'pm25', colormap: 'jet', min: 1, max: 18 }
const ranges = {
    mode: 'ranges',
    property: 'FRP',
    ranges: [
        { min: 0, color: '#FEF0D9' },
        { min: 10, color: '#FDCC8A', label: '10-49 MW' },
    ],
}

describe('Color by Value on save', () => {
    test.each([
        ['no setting', undefined],
        ['single color', { mode: 'single', colormap: 'viridis' }],
        ['a usable colormap', colormap],
        ['a colormap with bounds written as text', { ...colormap, min: '1', max: '18' }],
        ['usable ranges', ranges],
        ['a first band open below', { ...ranges, ranges: [{ min: null, color: '#000' }] }],
    ])('accepts %s', (_label, colorBy) => {
        expect(reasons(colorBy)).toEqual([])
    })

    test.each([
        ['equal', 5, 5],
        ['reversed', 18, 1],
    ])('refuses a colormap whose bounds are %s', (_label, min, max) => {
        expect(reasons({ ...colormap, min, max })).toEqual([
            "Layer 'Layer': Color by Value's Minimum Data Value must be less than its Maximum Data Value.",
        ])
    })

    test.each([
        ['no minimum', { min: '' }],
        ['no maximum', { max: undefined }],
    ])('refuses a colormap with %s', (_label, change) => {
        expect(reasons({ ...colormap, ...change })).toEqual([
            "Layer 'Layer': Color by Value needs a Minimum and a Maximum Data Value.",
        ])
    })

    test('refuses a colormap with no ramp', () => {
        expect(reasons({ ...colormap, colormap: '' })).toEqual([
            "Layer 'Layer': Color by Value needs a Colormap.",
        ])
    })

    test.each([['colormap', colormap], ['ranges', ranges]])(
        'refuses %s with no Value Property',
        (_mode, colorBy) => {
            expect(reasons({ ...colorBy, property: ' ' })).toEqual([
                "Layer 'Layer': Color by Value needs a Value Property.",
            ])
        }
    )

    test('refuses ranges with no band', () => {
        expect(reasons({ ...ranges, ranges: [] })).toEqual([
            "Layer 'Layer': Color by Value needs at least one range.",
        ])
    })

    test('names each band missing a lower bound or a color', () => {
        expect(
            reasons({
                ...ranges,
                ranges: [{ min: 0, color: '#000' }, { color: '#111' }, { min: 50, color: '' }],
            })
        ).toEqual([
            "Layer 'Layer': Color by Value range 2 needs a Lower Bound.",
            "Layer 'Layer': Color by Value range 3 needs a Color.",
        ])
    })

    test('checks vector tile layers too', () => {
        const layer = {
            name: 'Tiles', uuid: 'b', type: 'MVTLayer', url: 'x',
            minZoom: 0, maxNativeZoom: 10, maxZoom: 10,
            style: { colorBy: { ...colormap, min: 5, max: 5 } },
        }
        const result = validate({ msv: {}, tools: [], layers: [layer] })
        expect(result.errors.map((e) => e.reason)).toEqual([
            "Layer 'Tiles': Color by Value's Minimum Data Value must be less than its Maximum Data Value.",
        ])
    })
})
