import { describe, test, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
    COLORMAP_SIZE,
    ColormapFormatError,
    colormapResponseToTable,
    reverseColormapTable,
    encodeColormapTable,
    decodeColormapTable,
    sampleColormapTable,
    colormapTableToCss,
    compareColormapTables,
    describeServiceError,
} from '../../src/essence/Basics/Colormaps/colormapTable.ts'

// Responses captured from the live VEDA and EIC tiling services
// (`/colorMaps/{name}`), stored byte-for-byte as served.
const fixture = (service, name) =>
    JSON.parse(
        readFileSync(
            `tests/unit/fixtures/colormaps/${service}/${name}.json`,
            'utf8'
        )
    )

const colourAt = (table, i) => Array.from(table.subarray(i * 4, i * 4 + 4))
const distinctColours = (table) => {
    const seen = new Set()
    for (let i = 0; i < COLORMAP_SIZE; i++) seen.add(colourAt(table, i).join())
    return seen.size
}
const expectMatchesResponse = (table, response) => {
    for (let i = 0; i < COLORMAP_SIZE; i++) {
        expect(colourAt(table, i)).toEqual(response[String(i)])
    }
}

const opaqueRamp = () => {
    const response = {}
    for (let i = 0; i < COLORMAP_SIZE; i++) response[i] = [i, 255 - i, 7, 255]
    return response
}

describe('colormapResponseToTable', () => {
    test.each([
        // Smooth ramps.
        ['veda', 'viridis'],
        ['veda', 'twilight'],
        ['eic', 'viridis'],
        // Stepped ramps: a handful of colours, each repeated over a band.
        ['veda', 'tab10'],
        ['veda', 'gaia-exposure'],
        ['eic', 'tab10'],
        // Category ramps: colours at the indices of category codes, a filler
        // everywhere else.
        ['veda', 'nlcd'],
        ['veda', 'tornado_ef_scale'],
        ['veda', 'soil_texture'],
        // Partly transparent ramps.
        ['veda', 'epa-ghgi-ch4'],
        ['veda', 's1_hydrosar_water_extent'],
        ['veda', 'opera_gen_dist_status'],
        // Deployment-custom ramps.
        ['eic', 'naqfc_pm25'],
        ['eic', 'naqfc_o3'],
    ])('reads %s %s colour for colour', (service, name) => {
        const response = fixture(service, name)
        const table = colormapResponseToTable(name, response)
        expect(table).toBeInstanceOf(Uint8ClampedArray)
        expect(table.length).toBe(COLORMAP_SIZE * 4)
        expectMatchesResponse(table, response)
    })

    test('a stepped ramp keeps its steps', () => {
        expect(distinctColours(colormapResponseToTable('tab10', fixture('veda', 'tab10')))).toBe(10)
        expect(
            distinctColours(colormapResponseToTable('gaia-exposure', fixture('veda', 'gaia-exposure')))
        ).toBe(8)
    })

    test('a category ramp keeps each category at its code', () => {
        const table = colormapResponseToTable('nlcd', fixture('veda', 'nlcd'))
        // NLCD class 11 is open water, 0 is unused (filled black).
        expect(colourAt(table, 11)).toEqual(fixture('veda', 'nlcd')['11'])
        expect(colourAt(table, 0)).toEqual([0, 0, 0, 255])
    })

    test('transparency survives: a ramp fading in from transparent still does', () => {
        const table = colormapResponseToTable('epa-ghgi-ch4', fixture('veda', 'epa-ghgi-ch4'))
        expect(table[3]).toBe(0)
        expect(table[255 * 4 + 3]).toBe(255)
        const alphas = Array.from({ length: COLORMAP_SIZE }, (_, i) => table[i * 4 + 3])
        expect(alphas.slice(0, 17).every((a, i, all) => i === 0 || a >= all[i - 1])).toBe(true)
    })

    test('transparency survives: transparent gaps between categories stay transparent', () => {
        const table = colormapResponseToTable(
            's1_hydrosar_water_extent',
            fixture('veda', 's1_hydrosar_water_extent')
        )
        expect(colourAt(table, 0)).toEqual([0, 0, 0, 0])
        expect(colourAt(table, 1)[3]).toBe(255)
        expect(colourAt(table, 255)).toEqual([0, 0, 0, 0])
    })

    test('reads colours by numeric index, not by key order', () => {
        const response = opaqueRamp()
        // A plain object enumerates integer keys in ascending order whatever
        // the JSON said, so a proxy stands in for a parser that keeps the
        // payload's own (here string-sorted) order.
        const stringOrder = Object.keys(response).sort()
        const proxy = new Proxy(response, { ownKeys: () => stringOrder })
        expect(Object.keys(proxy).slice(0, 3)).toEqual(['0', '1', '10'])
        expectMatchesResponse(colormapResponseToTable('proxied', proxy), response)
    })

    test('an RGB colour is opaque', () => {
        const response = {}
        for (let i = 0; i < COLORMAP_SIZE; i++) response[i] = [1, 2, 3]
        expect(colourAt(colormapResponseToTable('rgb', response), 9)).toEqual([1, 2, 3, 255])
    })

    describe('rejects what is not a 256-colour table, naming the ramp', () => {
        const expectRejected = (response, pattern) => {
            let error
            try {
                colormapResponseToTable('my_ramp', response)
            } catch (err) {
                error = err
            }
            expect(error).toBeInstanceOf(ColormapFormatError)
            expect(error.rampName).toBe('my_ramp')
            expect(error.message).toMatch(/^Colormap "my_ramp": /)
            expect(error.message).toMatch(pattern)
        }

        test('not an object', () => {
            expectRejected(null, /expected an object/)
            expectRejected('viridis', /expected an object/)
            expectRejected([[0, 0, 0, 255]], /got an array/)
        })

        test('too few or too many colours', () => {
            const short = opaqueRamp()
            delete short[255]
            expectRejected(short, /expected 256 colours, got 255/)
            expectRejected({ 0: [0, 0, 0], 1: [255, 255, 255] }, /got 2/)
            expectRejected({ ...opaqueRamp(), 256: [0, 0, 0, 255] }, /got 257/)
            expectRejected({}, /got 0/)
        })

        test('256 keys that are not 0-255', () => {
            const offByOne = {}
            for (let i = 1; i <= COLORMAP_SIZE; i++) offByOne[i] = [0, 0, 0, 255]
            expectRejected(offByOne, /missing colour at index 0/)
            const named = opaqueRamp()
            delete named[17]
            named.detail = [0, 0, 0, 255]
            expectRejected(named, /missing colour at index 17/)
        })

        test('a service error body, reporting its detail', () => {
            expectRejected(
                { detail: 'Colormap not found' },
                /the service answered with an error: Colormap not found$/
            )
            // TiTiler's answer for a name it does not serve (HTTP 422).
            expectRejected(
                fixture('veda', 'unknown-ramp-422'),
                /the service answered with an error: Input should be 'accent', /
            )
        })

        test('a colour that is not 3 or 4 channels of 0-255 integers', () => {
            for (const bad of [
                'red',
                [0, 0],
                [0, 0, 0, 0, 0],
                [0, 0, 256],
                [0, -1, 0],
                [0.5, 0, 0],
                [0, 0, '0'],
            ]) {
                const response = opaqueRamp()
                response[42] = bad
                expectRejected(response, /colour at index 42/)
            }
        })
    })
})

describe('reverseColormapTable', () => {
    test('is the exact mirror of the forward table', () => {
        const forward = colormapResponseToTable('viridis', fixture('veda', 'viridis'))
        const reversed = reverseColormapTable(forward)
        for (let i = 0; i < COLORMAP_SIZE; i++) {
            expect(colourAt(reversed, i)).toEqual(colourAt(forward, 255 - i))
        }
        expect(reverseColormapTable(reversed)).toEqual(forward)
    })

    test('keeps transparency in place', () => {
        const forward = colormapResponseToTable('epa-ghgi-ch4', fixture('veda', 'epa-ghgi-ch4'))
        const reversed = reverseColormapTable(forward)
        expect(reversed[255 * 4 + 3]).toBe(0)
    })
})

describe('encode / decode', () => {
    test('round-trips every captured ramp exactly', () => {
        for (const [service, name] of [
            ['veda', 'epa-ghgi-ch4'],
            ['veda', 'nlcd'],
            ['eic', 'naqfc_pm25'],
        ]) {
            const table = colormapResponseToTable(name, fixture(service, name))
            const hex = encodeColormapTable(table)
            expect(hex).toMatch(/^[0-9a-f]{2048}$/)
            expect(decodeColormapTable(name, hex)).toEqual(table)
        }
    })

    test('rejects a malformed string, naming the ramp', () => {
        expect(() => decodeColormapTable('broken', 'ff00')).toThrow(/Colormap "broken"/)
        expect(() => decodeColormapTable('broken', 'zz'.repeat(1024))).toThrow(ColormapFormatError)
        expect(() => decodeColormapTable('broken', 'FF'.repeat(1024))).toThrow(ColormapFormatError)
    })
})

describe('sampleColormapTable', () => {
    const table = colormapResponseToTable('ramp', opaqueRamp())

    test('truncates to an index, as the tiling service does, without blending', () => {
        expect(sampleColormapTable(table, 0)).toEqual([0, 255, 7, 255])
        expect(sampleColormapTable(table, 1)).toEqual([255, 0, 7, 255])
        expect(sampleColormapTable(table, 100 / 255)).toEqual([100, 155, 7, 255])
        // Anywhere between indices 100 and 101 reads index 100, no average.
        expect(sampleColormapTable(table, 100.4 / 255)[0]).toBe(100)
        expect(sampleColormapTable(table, 100.99 / 255)[0]).toBe(100)
        // Only the very top of the range reaches the last colour.
        expect(sampleColormapTable(table, 254.99 / 255)[0]).toBe(254)
    })

    test('reads index i at exactly i / 255 for every index', () => {
        for (let i = 0; i < COLORMAP_SIZE; i++) {
            expect(sampleColormapTable(table, i / 255)[0]).toBe(i)
        }
    })

    test('clamps out-of-range positions to the ends', () => {
        expect(sampleColormapTable(table, -3)[0]).toBe(0)
        expect(sampleColormapTable(table, 7)[0]).toBe(255)
        expect(sampleColormapTable(table, NaN)[0]).toBe(0)
    })

    test('a reversed table sampled at i / 255 is the forward one at (255 - i) / 255', () => {
        const reversed = reverseColormapTable(table)
        for (let i = 0; i < COLORMAP_SIZE; i++) {
            expect(sampleColormapTable(reversed, i / 255)).toEqual(
                sampleColormapTable(table, (255 - i) / 255)
            )
        }
    })
})

describe('colormapTableToCss', () => {
    test('lists 256 rgba() colours, alpha as a fraction', () => {
        const css = colormapTableToCss(
            colormapResponseToTable('epa-ghgi-ch4', fixture('veda', 'epa-ghgi-ch4'))
        )
        expect(css).toHaveLength(256)
        expect(css[0]).toBe('rgba(111, 76, 155, 0)')
        expect(css[255]).toBe('rgba(82, 26, 19, 1)')
    })
})

describe('compareColormapTables', () => {
    test('reports the largest channel difference and colours beyond tolerance', () => {
        const a = colormapResponseToTable('a', opaqueRamp())
        const b = a.slice()
        b[10 * 4] += 1
        b[20 * 4 + 3] -= 5
        expect(compareColormapTables(a, a)).toEqual({ maxDifference: 0, colorsBeyondTolerance: 0 })
        expect(compareColormapTables(a, b, 1)).toEqual({ maxDifference: 5, colorsBeyondTolerance: 1 })
        expect(compareColormapTables(a, b, 0)).toEqual({ maxDifference: 5, colorsBeyondTolerance: 2 })
    })
})

describe('describeServiceError', () => {
    test('reads a string detail or a list of validation messages', () => {
        expect(describeServiceError({ detail: 'Not found' })).toBe('Not found')
        expect(describeServiceError({ detail: [{ msg: 'a' }, { msg: 'b' }] })).toBe('a; b')
        expect(describeServiceError({ detail: { code: 7 } })).toBe('{"code":7}')
    })

    test('shortens a long detail', () => {
        const message = describeServiceError(fixture('veda', 'unknown-ramp-422'))
        expect(message.length).toBe(203)
        expect(message.endsWith('...')).toBe(true)
    })

    test('is null for anything that is not an error body', () => {
        expect(describeServiceError(null)).toBeNull()
        expect(describeServiceError([])).toBeNull()
        expect(describeServiceError(fixture('veda', 'tab10'))).toBeNull()
    })
})
