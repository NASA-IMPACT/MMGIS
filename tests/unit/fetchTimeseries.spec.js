import { describe, test, expect } from 'vitest'
import {
    getTimeseriesConfig,
    templateUrl,
    featureTitle,
    mapResponseSeries,
    buildPayload,
    TemplateError,
    MappingError,
} from '../../src/essence/Tools/FetchTimeseries/lib/timeseries.ts'
import { isChartSeriesPayload } from '../../src/essence/Tools/_shared/types/chartSeries.ts'

const FEATURE = {
    id: 'st-42',
    properties: { station_id: 'A 1', name: 'Station 42' },
    geometry: { type: 'Point', coordinates: [-97.7, 30.3] },
}

/** Shape of dev.openveda.cloud OGC feature responses: observations are
 *  features with datetime/value/parameter/units nested under properties. */
function aqsFeature(datetime, parameter, units, value, id) {
    return {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-73.76, 41.05] },
        id,
        properties: {
            datetime,
            parameter,
            station_code: '36-119-2004',
            units_of_measure: units,
            value,
        },
    }
}

const AQS_RESPONSE = {
    type: 'FeatureCollection',
    numberMatched: 4,
    features: [
        aqsFeature('2017-12-31T00:00:00', 'PM2.5', 'Micrograms/cubic meter (LC)', '5.445', 1),
        aqsFeature('2018-12-31T00:00:00', 'PM2.5', 'Micrograms/cubic meter (LC)', '5.298', 2),
        aqsFeature('2017-12-31T00:00:00', 'Ozone', 'Parts per million', '0.04281', 3),
        aqsFeature('2018-12-31T00:00:00', 'Ozone', 'Parts per million', '0.04322', 4),
    ],
}

const AQS_CONFIG = {
    url: 'https://x/{properties.station_code}',
    groupBy: 'properties.parameter',
    unitKey: 'properties.units_of_measure',
}

describe('fetchTimeseries lib', () => {
    describe('getTimeseriesConfig', () => {
        test('returns the block when present with a url', () => {
            const layer = { variables: { timeseries: { url: 'https://x/{id}' } } }
            expect(getTimeseriesConfig(layer)).toEqual({ url: 'https://x/{id}' })
        })

        test.each([
            ['no layer', null],
            ['no variables', {}],
            ['no timeseries block', { variables: {} }],
            ['missing url', { variables: { timeseries: {} } }],
            ['empty url', { variables: { timeseries: { url: '' } } }],
            ['enabled false', { variables: { timeseries: { enabled: false, url: 'https://x/{id}' } } }],
        ])('returns null for %s (click must be a no-op)', (_name, layer) => {
            expect(getTimeseriesConfig(layer)).toBeNull()
        })

        test('enabled true (or absent) keeps the block usable', () => {
            const layer = {
                variables: { timeseries: { enabled: true, url: 'https://x/{id}' } },
            }
            expect(getTimeseriesConfig(layer)).toEqual({
                enabled: true,
                url: 'https://x/{id}',
            })
        })
    })

    describe('templateUrl', () => {
        test('substitutes id, properties and point lon/lat, URL-encoded', () => {
            expect(
                templateUrl(
                    'https://x/{id}/{properties.station_id}?lon={lon}&lat={lat}',
                    FEATURE,
                ),
            ).toBe('https://x/st-42/A%201?lon=-97.7&lat=30.3')
        })

        test('throws TemplateError naming a missing property', () => {
            expect(() => templateUrl('https://x/{properties.nope}', FEATURE)).toThrow(
                TemplateError,
            )
            expect(() => templateUrl('https://x/{properties.nope}', FEATURE)).toThrow(
                /properties\.nope/,
            )
        })

        test('lon/lat fall back to the click location when geometry is empty', () => {
            // Vector-tile / deck.gl click paths synthesize features with an
            // empty geometry — the event's latlng is what always exists.
            const bare = { ...FEATURE, geometry: {} }
            expect(
                templateUrl('https://x?lon={lon}&lat={lat}', bare, {
                    lat: 30.3,
                    lng: -97.7,
                }),
            ).toBe('https://x?lon=-97.7&lat=30.3')
        })

        test('zero coordinates are valid values, not "missing"', () => {
            const equator = { ...FEATURE, geometry: {} }
            expect(
                templateUrl('https://x?lon={lon}&lat={lat}', equator, {
                    lat: 0,
                    lng: 0,
                }),
            ).toBe('https://x?lon=0&lat=0')
        })

        test('throws TemplateError for lon/lat with neither geometry nor latlng', () => {
            const poly = { ...FEATURE, geometry: { type: 'Polygon', coordinates: [] } }
            expect(() => templateUrl('https://x?lon={lon}', poly)).toThrow(
                TemplateError,
            )
        })

        test('properties placeholders resolve nested dot-paths', () => {
            const nested = {
                ...FEATURE,
                properties: { meta: { code: 'X9' } },
            }
            expect(
                templateUrl('https://x/{properties.meta.code}', nested),
            ).toBe('https://x/X9')
        })

        test('throws TemplateError when a placeholder resolves to an object', () => {
            const nested = { ...FEATURE, properties: { meta: { code: 'X9' } } }
            expect(() =>
                templateUrl('https://x/{properties.meta}', nested),
            ).toThrow(/non-scalar/)
        })

        test('throws TemplateError for unknown placeholders', () => {
            expect(() => templateUrl('https://x/{bogus}', FEATURE)).toThrow(
                /Unsupported placeholder/,
            )
        })
    })

    describe('featureTitle', () => {
        const cfg = { url: 'x' }
        test('prefers the configured property', () => {
            expect(
                featureTitle(FEATURE, { ...cfg, titleProp: 'station_id' }, 'L'),
            ).toBe('A 1')
        })
        test('falls back name → id → provided fallback', () => {
            expect(featureTitle(FEATURE, cfg, 'L')).toBe('Station 42')
            expect(featureTitle({ id: 7, properties: {} }, cfg, 'L')).toBe('7')
            expect(featureTitle({ properties: {} }, cfg, 'L')).toBe('L')
        })
    })

    describe('mapResponseSeries', () => {
        test('maps a bare array of {datetime, value} objects by default', () => {
            const series = mapResponseSeries(
                [
                    { datetime: '2026-01-01T00:00:00Z', value: 1 },
                    { datetime: '2026-01-02T00:00:00Z', value: '2.5' },
                    { datetime: '2026-01-03T00:00:00Z', value: null },
                ],
                { url: 'x' },
            )
            expect(series).toEqual([
                {
                    key: '',
                    unit: undefined,
                    points: [
                        { x: '2026-01-01T00:00:00Z', y: 1 },
                        { x: '2026-01-02T00:00:00Z', y: 2.5 },
                        { x: '2026-01-03T00:00:00Z', y: null },
                    ],
                },
            ])
        })

        test('finds the array under common container keys', () => {
            const series = mapResponseSeries(
                { data: [{ date: '2026-01-01', mean: 3 }] },
                { url: 'x' },
            )
            expect(series[0].points).toEqual([{ x: '2026-01-01', y: 3 }])
        })

        test('honors seriesPath and explicit dot-path xKey/yKey', () => {
            const series = mapResponseSeries(
                { a: { b: [{ meta: { ts: 100 }, no2: 4 }] } },
                { url: 'x', seriesPath: 'a.b', xKey: 'meta.ts', yKey: 'no2' },
            )
            expect(series[0].points).toEqual([{ x: 100, y: 4 }])
        })

        test('supports parallel arrays via xKey/yKey', () => {
            const series = mapResponseSeries(
                { data: { times: ['2026-01-01', '2026-01-02'], vals: [1, 2] } },
                { url: 'x', seriesPath: 'data', xKey: 'times', yKey: 'vals' },
            )
            expect(series).toEqual([
                {
                    key: '',
                    points: [
                        { x: '2026-01-01', y: 1 },
                        { x: '2026-01-02', y: 2 },
                    ],
                },
            ])
        })

        test('OGC FeatureCollection works with zero key config: features container, properties.* auto keys', () => {
            const series = mapResponseSeries(AQS_RESPONSE, { url: 'x' })
            // No groupBy: all observations land in one series.
            expect(series).toHaveLength(1)
            expect(series[0].points).toHaveLength(4)
            expect(series[0].points[0]).toEqual({
                x: '2017-12-31T00:00:00',
                y: 5.445,
            })
        })

        // tipg serves the same items as FLAT rows (no `properties` nesting)
        // under `Accept: application/json` — config paths written for the
        // GeoJSON shape must still resolve.
        test('flat rows: properties.* config paths group and tag units anyway', () => {
            const flat = [
                { datetime: '2017-12-31T00:00:00', parameter: 'PM2.5', units_of_measure: 'µg/m³', value: '5.4' },
                { datetime: '2018-12-31T00:00:00', parameter: 'PM2.5', units_of_measure: 'µg/m³', value: '5.2' },
                { datetime: '2017-12-31T00:00:00', parameter: 'Ozone', units_of_measure: 'ppm', value: '0.042' },
            ]
            const series = mapResponseSeries(flat, AQS_CONFIG)
            expect(series.map((s) => [s.key, s.unit, s.points.length])).toEqual([
                ['PM2.5', 'µg/m³', 2],
                ['Ozone', 'ppm', 1],
            ])
        })

        test('nested rows: bare config paths resolve under properties too', () => {
            const series = mapResponseSeries(AQS_RESPONSE, {
                url: 'x',
                groupBy: 'parameter',
                unitKey: 'units_of_measure',
            })
            expect(series.map((s) => s.key).sort()).toEqual(['Ozone', 'PM2.5'])
            expect(series[0].unit).toBeDefined()
        })

        test('groupBy splits per parameter and unitKey tags each series', () => {
            const series = mapResponseSeries(AQS_RESPONSE, AQS_CONFIG)
            expect(series).toHaveLength(2)
            expect(series[0]).toEqual({
                key: 'PM2.5',
                unit: 'Micrograms/cubic meter (LC)',
                points: [
                    { x: '2017-12-31T00:00:00', y: 5.445 },
                    { x: '2018-12-31T00:00:00', y: 5.298 },
                ],
            })
            expect(series[1].key).toBe('Ozone')
            expect(series[1].unit).toBe('Parts per million')
            expect(series[1].points.map((p) => p.y)).toEqual([0.04281, 0.04322])
        })

        test('non-numeric values become null gaps', () => {
            const series = mapResponseSeries(
                [
                    { datetime: 'a', value: 'n/a' },
                    { datetime: 'b', value: 2 },
                ],
                { url: 'x' },
            )
            expect(series[0].points).toEqual([
                { x: 'a', y: null },
                { x: 'b', y: 2 },
            ])
        })

        test('parallel arrays at the response root need no seriesPath', () => {
            const series = mapResponseSeries(
                { times: ['2026-01-01', '2026-01-02'], vals: [1, 2] },
                { url: 'x', xKey: 'times', yKey: 'vals' },
            )
            expect(series[0].points).toEqual([
                { x: '2026-01-01', y: 1 },
                { x: '2026-01-02', y: 2 },
            ])
        })

        test('parallel arrays resolve dot-path keys', () => {
            const series = mapResponseSeries(
                { result: { t: ['2026-01-01'], v: [3] } },
                { url: 'x', xKey: 'result.t', yKey: 'result.v' },
            )
            expect(series[0].points).toEqual([{ x: '2026-01-01', y: 3 }])
        })

        test('ragged parallel arrays name the length mismatch', () => {
            expect(() =>
                mapResponseSeries(
                    { times: ['a', 'b'], vals: [1] },
                    { url: 'x', xKey: 'times', yKey: 'vals' },
                ),
            ).toThrow(/different lengths/)
        })

        test('a configured key matching nothing blames the config, not the API', () => {
            expect(() =>
                mapResponseSeries(
                    [{ datetime: '2026-01-01', value: 1 }],
                    { url: 'x', xKey: 'timestamp_utc' },
                ),
            ).toThrow(/Configured xKey 'timestamp_utc'/)
        })

        test('a populated container is preferred over an empty one', () => {
            const series = mapResponseSeries(
                {
                    data: [],
                    features: [{ properties: { datetime: 'a', value: 1 } }],
                },
                { url: 'x' },
            )
            expect(series[0].points).toEqual([{ x: 'a', y: 1 }])
        })

        test('key auto-detection skips past a leading metadata row', () => {
            const series = mapResponseSeries(
                [{ meta: true }, { datetime: 'a', value: 1 }],
                { url: 'x' },
            )
            expect(series[0].points).toEqual([{ x: 'a', y: 1 }])
        })

        test('all-null values point at yKey instead of an empty plot', () => {
            expect(() =>
                mapResponseSeries(
                    [
                        { datetime: 'a', value: 'n/a' },
                        { datetime: 'b', value: null },
                    ],
                    { url: 'x' },
                ),
            ).toThrow(/no numeric values/)
        })

        test.each([
            ['empty array', []],
            ['empty container', { data: [] }],
            ['unrecognized shape', { weird: true }],
            ['no matching keys', [{ when: '2026-01-01', amount: 2 }]],
        ])('throws MappingError for %s', (_name, response) => {
            expect(() => mapResponseSeries(response, { url: 'x' })).toThrow(
                MappingError,
            )
        })
    })

    describe('buildPayload', () => {
        test('produces a valid single-series time payload with provenance', () => {
            const payload = buildPayload({
                chartId: 'vector-timeseries',
                response: [{ datetime: '2026-01-01', value: 1 }],
                config: { url: 'x', yLabel: 'NO₂', label: 'NO₂' },
                title: 'Station 42',
                layerDisplayName: 'Air Stations',
                layerName: 'uuid-1',
                featureId: 'st-42',
            })
            expect(payload).toEqual({
                chartId: 'vector-timeseries',
                title: 'Station 42',
                subtitle: 'Air Stations',
                xType: 'time',
                yLabel: 'NO₂',
                series: [
                    {
                        id: 'timeseries',
                        label: 'NO₂',
                        unit: undefined,
                        points: [{ x: '2026-01-01', y: 1 }],
                    },
                ],
                meta: {
                    sourcePlugin: 'fetch-timeseries',
                    layerName: 'uuid-1',
                    featureId: 'st-42',
                },
            })
        })

        test('grouped responses become one labeled series per group', () => {
            const payload = buildPayload({
                chartId: 'vector-timeseries',
                response: AQS_RESPONSE,
                config: AQS_CONFIG,
                title: 'White Plains',
                layerDisplayName: 'AQS Stations',
                layerName: 'uuid-1',
                featureId: 16919,
            })
            expect(payload.series.map((s) => ({ id: s.id, label: s.label, unit: s.unit }))).toEqual([
                {
                    id: 'pm2-5',
                    label: 'PM2.5',
                    unit: 'Micrograms/cubic meter (LC)',
                },
                { id: 'ozone', label: 'Ozone', unit: 'Parts per million' },
            ])
        })

        test('configured xType passes through; unknown values degrade to time', () => {
            const base = {
                chartId: 'c',
                response: [{ datetime: '2017', value: 1 }],
                title: 'T',
                layerDisplayName: 'L',
                layerName: 'uuid-1',
            }
            expect(
                buildPayload({ ...base, config: { url: 'x', xType: 'linear' } })
                    .xType,
            ).toBe('linear')
            expect(buildPayload({ ...base, config: { url: 'x' } }).xType).toBe(
                'time',
            )
            expect(
                buildPayload({
                    ...base,
                    config: { url: 'x', xType: 'datetime' },
                }).xType,
            ).toBe('time')
        })

        test('a paginated response marks the title as truncated', () => {
            const payload = buildPayload({
                chartId: 'c',
                response: {
                    numberMatched: 4128,
                    numberReturned: 2,
                    features: [
                        aqsFeature('2017-12-31T00:00:00', 'Ozone', 'ppm', '1', 1),
                        aqsFeature('2018-12-31T00:00:00', 'Ozone', 'ppm', '2', 2),
                    ],
                },
                config: { url: 'x' },
                title: 'Station 42',
                layerDisplayName: 'L',
                layerName: 'uuid-1',
            })
            expect(payload.title).toBe(
                'Station 42 (first 2 of 4128 points)',
            )
        })

        test('a complete response keeps its title untouched', () => {
            const payload = buildPayload({
                chartId: 'c',
                response: AQS_RESPONSE,
                config: AQS_CONFIG,
                title: 'Station 42',
                layerDisplayName: 'L',
                layerName: 'uuid-1',
            })
            expect(payload.title).toBe('Station 42')
        })

        test('colliding slugs get suffixed ids the chart guard accepts', () => {
            const payload = buildPayload({
                chartId: 'c',
                response: [
                    { datetime: 'a', value: 1, city: '北京' },
                    { datetime: 'b', value: 2, city: '上海' },
                ],
                config: { url: 'x', groupBy: 'city' },
                title: 'T',
                layerDisplayName: 'L',
                layerName: 'uuid-1',
            })
            expect(payload.series.map((s) => s.id)).toEqual([
                'series',
                'series-2',
            ])
            expect(isChartSeriesPayload(payload)).toBe(true)
        })

        test('series label falls back to the layer display name', () => {
            const payload = buildPayload({
                chartId: 'c',
                response: [{ datetime: 'a', value: 1 }],
                config: { url: 'x' },
                title: 'T',
                layerDisplayName: 'Air Stations',
                layerName: 'uuid-1',
            })
            expect(payload.series[0].label).toBe('Air Stations')
        })
    })
})
