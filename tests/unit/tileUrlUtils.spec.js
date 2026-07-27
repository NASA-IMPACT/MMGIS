import { test, expect, describe } from 'vitest'
import {
    processExpression,
    applyCogFieldsToUrl,
    compileTileUrl,
    resolveTileFormat,
    formatLayerTime,
    buildTileUrlOptions,
} from '../../src/essence/Basics/Layers_/tileUrlUtils.ts'

describe('tileUrlUtils', () => {
    describe('processExpression', () => {
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

    describe('applyCogFieldsToUrl', () => {
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

    describe('resolveTileFormat', () => {
        test('defaults to tms when neither tileformat nor tms is set', () => {
            expect(resolveTileFormat({})).toBe('tms')
        })
        test('honours tms:false as wmts', () => {
            expect(resolveTileFormat({ tms: false })).toBe('wmts')
        })
        test('honours tms:true as tms', () => {
            expect(resolveTileFormat({ tms: true })).toBe('tms')
        })
        test('explicit tileformat wins over tms', () => {
            expect(resolveTileFormat({ tileformat: 'wmts', tms: true })).toBe('wmts')
        })
    })

    describe('formatLayerTime', () => {
        test('defaults to ISO when format is absent', () => {
            expect(formatLayerTime()('2024-03-04T14:05:00Z')).toBe('2024-03-04T14:05:00Z')
        })
        test('defaults to ISO when format is empty string', () => {
            expect(formatLayerTime('')('2024-03-04T14:05:00Z')).toBe('2024-03-04T14:05:00Z')
        })
        test('supports day-of-year (%j)', () => {
            expect(formatLayerTime('%Y-%j')('2024-03-04T14:05:00Z')).toBe('2024-064')
        })
        test('returns empty string for missing/invalid input rather than NaN garbage', () => {
            const f = formatLayerTime('%Y-%m-%d')
            expect(f(undefined)).toBe('')
            expect(f(null)).toBe('')
            expect(f('')).toBe('')
            expect(f('garbage')).toBe('')
        })
        test('formats in UTC — a late-day UTC time keeps its UTC date regardless of TZ', () => {
            // 23:00Z is the previous local day west of UTC and the next local
            // day far east; a UTC formatter must still report 2024-03-04. This
            // is the whole reason d3 utcFormat is used instead of local Date.
            expect(formatLayerTime('%Y-%m-%d')('2024-03-04T23:00:00Z')).toBe('2024-03-04')
            expect(formatLayerTime('%H')('2024-03-04T23:00:00Z')).toBe('23')
        })
    })

    describe('buildTileUrlOptions', () => {
        test('formats times once using the layer format', () => {
            const o = buildTileUrlOptions(
                { name: 'x', time: { enabled: true, format: '%m/%d/%Y',
                                     start: '2024-03-01T00:00:00Z', end: '2024-03-04T00:00:00Z' } },
                undefined
            )
            expect(o.starttime).toBe('03/01/2024')
            expect(o.endtime).toBe('03/04/2024')
            expect(o.time).toBe('03/04/2024')
        })
        test('yields empty time strings when no time config', () => {
            const o = buildTileUrlOptions({ name: 'x' }, 'COG')
            expect(o.starttime).toBe('')
            expect(o.endtime).toBe('')
            expect(o.splitColonType).toBe('COG')
        })
        test('resolves tileFormat from tms', () => {
            expect(buildTileUrlOptions({ tms: false }, undefined).tileFormat).toBe('wmts')
        })
        test('preserves COG fields for applyCogFieldsToUrl', () => {
            const o = buildTileUrlOptions({ cogTransform: true, cogColormap: 'viridis' }, 'COG')
            expect(o.cogTransform).toBe(true)
            expect(o.cogColormap).toBe('viridis')
        })
        test('applies chosen defaults for compositeTile and customTimes', () => {
            const o = buildTileUrlOptions({ name: 'x' }, undefined)
            expect(o.compositeTile).toBe(false)
            expect(o.customTimes).toBe(null)
        })
        test('passes through compositeTile and customTimes when present', () => {
            const times = ['2024-01-01T00:00:00Z']
            const o = buildTileUrlOptions(
                { time: { compositeTile: true, customTimes: { times } } },
                undefined
            )
            expect(o.compositeTile).toBe(true)
            expect(o.customTimes).toEqual({ times })
        })
    })

    describe('compileTileUrl — datetime', () => {
        test('omits datetime entirely when the layer has no time config', () => {
            const opts = buildTileUrlOptions({ cogTransform: true, cogColormap: 'viridis' }, 'COG')
            const url = compileTileUrl('https://t/{z}/{x}/{y}.png', opts)
            expect(url).not.toContain('datetime')
            expect(url).toContain('colormap_name=viridis')
        })
        test('uses ../end when only endtime is present', () => {
            const opts = buildTileUrlOptions(
                { time: { enabled: true, end: '2024-03-04T00:00:00Z' } }, 'stac-collection')
            const url = compileTileUrl('https://t/{z}/{x}/{y}.png', opts)
            // datetime is asserted via URLSearchParams (decoded) rather than a raw
            // substring match: applyCogFieldsToUrl round-trips the whole query
            // string through URLSearchParams, which percent-encodes ':' and '/'
            // in the already-appended datetime value. That's pre-existing,
            // unrelated behavior — out of scope here — so we compare semantics.
            expect(new URL(url).searchParams.get('datetime')).toBe('../2024-03-04T00:00:00Z')
        })
        test('uses start/end when both are present', () => {
            const opts = buildTileUrlOptions(
                { time: { enabled: true, start: '2024-03-01T00:00:00Z', end: '2024-03-04T00:00:00Z' } },
                'stac-collection')
            const url = compileTileUrl('https://t/{z}/{x}/{y}.png', opts)
            expect(new URL(url).searchParams.get('datetime'))
                .toBe('2024-03-01T00:00:00Z/2024-03-04T00:00:00Z')
        })
    })

    describe('compileTileUrl — never re-formats', () => {
        test('passes pre-formatted times through unchanged (timezone independent)', () => {
            const opts = {
                time: '03/04/2024', starttime: '03/04/2024', endtime: '03/04/2024',
                tileFormat: 'wmts',
            }
            const url = compileTileUrl('https://t/{z}/{x}/{y}.png?d={time}', opts)
            expect(url).toContain('d=03/04/2024')
        })
        test('ignores a stray timeFormat option — no reformatting in any timezone', () => {
            // If the deleted formatter came back, %Y would collapse this to
            // "2024". The pass-through keeps the full string. The two differ in
            // EVERY timezone (the format changes the string itself, not just the
            // date), so this fails deterministically on a UTC CI runner too —
            // unlike a M/D/Y fixture, which only shifts east of UTC.
            const opts = {
                time: '2024-03-04T23:00:00Z',
                starttime: '2024-03-04T23:00:00Z',
                endtime: '2024-03-04T23:00:00Z',
                timeFormat: '%Y', tileFormat: 'wmts',
            }
            const url = compileTileUrl('https://t/{z}/{x}/{y}.png?d={time}', opts)
            expect(url).toContain('d=2024-03-04T23:00:00Z')
            expect(url).not.toContain('d=2024&')
        })
    })

    describe('compileTileUrl — tms params', () => {
        test('appends starttime/time for tms layers', () => {
            const opts = buildTileUrlOptions(
                { tms: true, time: { enabled: true, start: '2024-03-01T00:00:00Z', end: '2024-03-04T00:00:00Z' } },
                undefined)
            const url = compileTileUrl('https://t/{z}/{x}/{y}.png', opts)
            expect(url).toContain('starttime=2024-03-01T00:00:00Z')
            expect(url).toContain('time=2024-03-04T00:00:00Z')
        })
        test('does NOT append tms params for a tms:false layer', () => {
            const opts = buildTileUrlOptions(
                { tms: false, time: { enabled: true, start: '2024-03-01T00:00:00Z', end: '2024-03-04T00:00:00Z' } },
                undefined)
            const url = compileTileUrl('https://t/{z}/{x}/{y}.png', opts)
            expect(url).not.toContain('starttime=')
        })
        test('appends composite=true only when compositeTile is set', () => {
            const opts = buildTileUrlOptions(
                { tms: true, time: { enabled: true, compositeTile: true,
                                     start: '2024-03-01T00:00:00Z', end: '2024-03-04T00:00:00Z' } },
                undefined)
            expect(compileTileUrl('https://t/{z}/{x}/{y}.png', opts)).toContain('composite=true')
        })
    })

    describe('compileTileUrl — custom time tokens', () => {
        test('substitutes {customtime.N} for each entry', () => {
            const opts = {
                time: '', starttime: '', endtime: '',
                customTimes: { times: ['2024-01-01T00:00:00Z', '2024-02-02T00:00:00Z'] },
            }
            const url = compileTileUrl('https://t/{customtime.0}/{customtime.1}.png', opts)
            expect(url).toBe('https://t/2024-01-01T00:00:00Z/2024-02-02T00:00:00Z.png')
        })
    })

    describe('compileTileUrl — empty-time placeholders', () => {
        test('collapses {time}/{starttime}/{endtime} to empty when no time configured', () => {
            // No time config → buildTileUrlOptions yields '' for every time value.
            // The placeholders must be removed, not left as literal {time} the
            // server would 404 on.
            const opts = buildTileUrlOptions({ name: 'x' }, undefined)
            const url = compileTileUrl(
                'https://t/{starttime}/{endtime}/{time}.png',
                opts
            )
            expect(url).toBe('https://t///.png')
            expect(url).not.toContain('{time}')
            expect(url).not.toContain('{starttime}')
            expect(url).not.toContain('{endtime}')
        })
    })

    describe('buildTileUrlOptions — closed key set', () => {
        // TimeControl hands this object straight to the middleware's
        // refresh(), which copies every key onto this.options. Anything that
        // leaks out of the layer config would clobber the creation-time
        // options built in Map_.makeTileLayer.
        const opts = buildTileUrlOptions(
            {
                name: 'x',
                minZoom: '3',
                maxZoom: '18',
                maxNativeZoom: '18',
                boundingBox: [0, 0, 1, 1],
                style: { color: 'red' },
                url: 'https://raw/{z}/{x}/{y}.png',
                variables: { a: 1 },
                cogTransform: true,
                cogColormap: 'viridis',
                cogResampling: 'bilinear',
                time: { enabled: true, end: '2024-03-04T00:00:00Z' },
            },
            'COG'
        )

        test('carries every key compileTileUrl reads', () => {
            expect(opts.splitColonType).toBe('COG')
            expect(opts.time).toBe('2024-03-04T00:00:00Z')
            expect(opts.tileFormat).toBe('tms')
            expect(opts.cogTransform).toBe(true)
            expect(opts.cogColormap).toBe('viridis')
            expect(opts.cogResampling).toBe('bilinear')
        })

        test('carries nothing else from the layer config', () => {
            expect(Object.keys(opts).sort()).toEqual([
                'cogColormap',
                'cogExpression',
                'cogMax',
                'cogMin',
                'cogResampling',
                'cogTransform',
                'compositeTile',
                'currentCogExpression',
                'currentCogMax',
                'currentCogMin',
                'customTimes',
                'endtime',
                'splitColonType',
                'starttime',
                'tileFormat',
                'time',
            ])
        })
    })

    describe('compileTileUrl — placeholders inside a query string', () => {
        // Regression: the param-injection block round-trips the query through
        // URLSearchParams, which percent-encodes the braces. If it ran before
        // the replacements, `{time}` became `%7Btime%7D` and never resolved.
        // Leaflet masks that (L.Util.template substitutes from options first);
        // DeckGL, which compiles the URL wholesale, does not.
        const opts = buildTileUrlOptions(
            {
                cogTransform: true,
                cogColormap: 'viridis',
                time: {
                    enabled: true,
                    start: '2024-03-01T00:00:00Z',
                    end: '2024-03-04T00:00:00Z',
                },
            },
            'titiler-url'
        )

        test('substitutes {time} in a query param', () => {
            const url = compileTileUrl(
                'https://titiler/tiles/{z}/{x}/{y}?url=x.tif&date={time}',
                opts
            )
            expect(url).not.toContain('%7Btime%7D')
            expect(url).not.toContain('{time}')
            expect(decodeURIComponent(url)).toContain(
                'date=2024-03-04T00:00:00Z'
            )
        })

        test('substitutes {starttime}/{endtime} in a query param', () => {
            const url = decodeURIComponent(
                compileTileUrl(
                    'https://titiler/tiles/{z}/{x}/{y}?from={starttime}&to={endtime}',
                    opts
                )
            )
            expect(url).toContain('from=2024-03-01T00:00:00Z')
            expect(url).toContain('to=2024-03-04T00:00:00Z')
        })

        test('substitutes {customtime.N} in a query param', () => {
            const url = decodeURIComponent(
                compileTileUrl(
                    'https://titiler/tiles/{z}/{x}/{y}?url=x.tif&at={customtime.0}',
                    {
                        ...opts,
                        customTimes: { times: ['2024-05-05T00:00:00Z'] },
                    }
                )
            )
            expect(url).toContain('at=2024-05-05T00:00:00Z')
        })

        test('still substitutes placeholders in the path', () => {
            const url = compileTileUrl('https://t/{time}/{z}/{x}/{y}.png', opts)
            expect(url).toContain('/2024-03-04T00:00:00Z/')
        })
    })

    describe('compileTileUrl — stac-collection params', () => {
        const stacOpts = (extra = {}) =>
            buildTileUrlOptions(
                {
                    time: {
                        enabled: true,
                        start: '2024-03-01T00:00:00Z',
                        end: '2024-03-04T00:00:00Z',
                    },
                    ...extra,
                },
                'stac-collection'
            )

        test('appends the mosaic scan flags', () => {
            const url = compileTileUrl('https://s/{z}/{x}/{y}.png', stacOpts())
            expect(url).toContain('exitwhenfull=false')
            expect(url).toContain('skipcovered=false')
        })

        test('does not append the scan flags for COG or titiler-url', () => {
            for (const type of ['COG', 'titiler-url']) {
                const opts = buildTileUrlOptions(
                    { time: { enabled: true, end: '2024-03-04T00:00:00Z' } },
                    type
                )
                expect(
                    compileTileUrl('https://s/{z}/{x}/{y}.png', opts)
                ).not.toContain('exitwhenfull')
            }
        })

        test('injects the global mosaic limits when configured', () => {
            const previous = window.mmgisglobal
            window.mmgisglobal = {
                options: {
                    stac: {
                        mosaicItemLimit: 20,
                        mosaicScanLimit: 100,
                        mosaicTimeLimit: 5,
                    },
                },
            }
            try {
                const url = compileTileUrl(
                    'https://s/{z}/{x}/{y}.png',
                    stacOpts()
                )
                expect(url).toContain('items_limit=20')
                expect(url).toContain('scan_limit=100')
                expect(url).toContain('time_limit=5')
            } finally {
                window.mmgisglobal = previous
            }
        })

        test('omits any limit that is not configured', () => {
            const previous = window.mmgisglobal
            window.mmgisglobal = {
                options: { stac: { mosaicItemLimit: 20 } },
            }
            try {
                const url = compileTileUrl(
                    'https://s/{z}/{x}/{y}.png',
                    stacOpts()
                )
                expect(url).toContain('items_limit=20')
                expect(url).not.toContain('scan_limit')
                expect(url).not.toContain('time_limit')
            } finally {
                window.mmgisglobal = previous
            }
        })
    })

    describe('compileTileUrl — tms param de-duplication', () => {
        const tmsOpts = buildTileUrlOptions(
            {
                tms: true,
                time: {
                    enabled: true,
                    compositeTile: true,
                    start: '2024-03-01T00:00:00Z',
                    end: '2024-03-04T00:00:00Z',
                },
            },
            undefined
        )

        test('leaves a starttime already in the URL alone', () => {
            const url = compileTileUrl(
                'https://t/{z}/{x}/{y}.png?starttime=custom',
                tmsOpts
            )
            expect(url).toContain('starttime=custom')
            expect(url).not.toContain('starttime=2024-03-01T00:00:00Z')
            // the params that are absent are still appended
            expect(url).toContain('time=2024-03-04T00:00:00Z')
            expect(url).toContain('composite=true')
        })

        test('leaves a time already in the URL alone', () => {
            const url = compileTileUrl(
                'https://t/{z}/{x}/{y}.png?time=custom',
                tmsOpts
            )
            expect(url.match(/[?&]time=/g)).toHaveLength(1)
            expect(url).toContain('starttime=2024-03-01T00:00:00Z')
        })

        test('leaves a composite already in the URL alone', () => {
            const url = compileTileUrl(
                'https://t/{z}/{x}/{y}.png?composite=false',
                tmsOpts
            )
            expect(url).toContain('composite=false')
            expect(url).not.toContain('composite=true')
        })
    })

    describe('compileTileUrl — titiler-url', () => {
        test('gets datetime and COG params like COG layers do', () => {
            const opts = buildTileUrlOptions(
                {
                    cogTransform: true,
                    cogColormap: 'viridis',
                    cogMin: 0,
                    cogMax: 100,
                    time: {
                        enabled: true,
                        start: '2024-03-01T00:00:00Z',
                        end: '2024-03-04T00:00:00Z',
                    },
                },
                'titiler-url'
            )
            const url = decodeURIComponent(
                compileTileUrl('https://titiler/tiles/{z}/{x}/{y}', opts)
            )
            expect(url).toContain(
                'datetime=2024-03-01T00:00:00Z/2024-03-04T00:00:00Z'
            )
            expect(url).toContain('colormap_name=viridis')
            expect(url).toContain('rescale=0,100')
        })
    })
})
