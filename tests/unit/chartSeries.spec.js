import { describe, test, expect } from 'vitest'
import {
    seriesEvents,
    isChartSeriesPayload,
} from '../../src/essence/Tools/_shared/types/chartSeries.ts'

const validPayload = {
    chartId: 'vector-timeseries',
    title: 'Station 42',
    xType: 'time',
    series: [
        {
            id: 'no2',
            label: 'NO₂',
            points: [
                { x: '2026-01-01T00:00:00Z', y: 1.5 },
                { x: '2026-01-02T00:00:00Z', y: null },
                { x: '2026-01-03T00:00:00Z', y: 2 },
            ],
        },
    ],
}

describe('chartSeries contract', () => {
    describe('seriesEvents', () => {
        test('builds the four plugin-prefixed event names', () => {
            expect(seriesEvents('fetch-timeseries')).toEqual({
                loading: 'plugin:fetch-timeseries:seriesLoading',
                ready: 'plugin:fetch-timeseries:seriesReady',
                error: 'plugin:fetch-timeseries:seriesError',
                cleared: 'plugin:fetch-timeseries:seriesCleared',
            })
        })
    })

    describe('isChartSeriesPayload', () => {
        test('accepts a valid single-series payload with null gaps', () => {
            expect(isChartSeriesPayload(validPayload)).toBe(true)
        })

        test('accepts multi-series payloads (raster/forecast cases)', () => {
            const multi = {
                ...validPayload,
                series: [
                    validPayload.series[0],
                    {
                        id: 'forecast',
                        label: 'Forecast',
                        style: 'line',
                        color: '#888',
                        points: [{ x: 1, y: 2 }],
                    },
                ],
            }
            expect(isChartSeriesPayload(multi)).toBe(true)
        })

        test.each([
            ['null', null],
            ['non-object', 'nope'],
            ['missing chartId', { ...validPayload, chartId: undefined }],
            ['empty chartId', { ...validPayload, chartId: '' }],
            ['missing title', { ...validPayload, title: undefined }],
            ['bad xType', { ...validPayload, xType: 'datetime' }],
            ['empty series', { ...validPayload, series: [] }],
            ['series not array', { ...validPayload, series: {} }],
            [
                'series missing id',
                { ...validPayload, series: [{ label: 'x', points: [] }] },
            ],
            [
                'point with undefined y',
                {
                    ...validPayload,
                    series: [{ id: 'a', label: 'a', points: [{ x: 1 }] }],
                },
            ],
            [
                'point with string y',
                {
                    ...validPayload,
                    series: [
                        { id: 'a', label: 'a', points: [{ x: 1, y: '2' }] },
                    ],
                },
            ],
            [
                'duplicate series ids',
                {
                    ...validPayload,
                    series: [
                        { id: 'a', label: 'A', points: [{ x: 1, y: 1 }] },
                        { id: 'a', label: 'B', points: [{ x: 1, y: 2 }] },
                    ],
                },
            ],
            [
                'duplicate series labels',
                {
                    ...validPayload,
                    series: [
                        { id: 'a', label: 'Same', points: [{ x: 1, y: 1 }] },
                        { id: 'b', label: 'Same', points: [{ x: 1, y: 2 }] },
                    ],
                },
            ],
        ])('rejects %s', (_name, payload) => {
            expect(isChartSeriesPayload(payload)).toBe(false)
        })
    })
})
