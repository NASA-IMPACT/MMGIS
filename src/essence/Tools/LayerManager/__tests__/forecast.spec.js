import { test, expect } from 'vitest'
import {
    parseStep,
    stepsBetween,
    coordinatesEndpointFor,
    newestRuns,
    leadRangeOf,
    runSpan,
    formatRun,
    runAge,
    formatLead,
    readForecastConfig,
} from '../lib/utils/forecast.ts'

const NAQFC =
    'https://k57yourj75.execute-api.us-west-2.amazonaws.com/tiles/WebMercatorQuad/{z}/{x}/{y}?url=s3://airquality-data-store-develop/naqfc/aqmv7/o3_conus&url=s3://airquality-data-store-develop/naqfc/aqmv7/o3_ak&variable=ozcon&sel=reference_time=nearest::{reftime}&sel=lead=nearest::{lead}'

test.describe('coordinatesEndpointFor', () => {
    test('derives the service and first store from a multidim tile URL', () => {
        expect(coordinatesEndpointFor(NAQFC, 'reference_time')).toBe(
            'https://k57yourj75.execute-api.us-west-2.amazonaws.com/dataset/coordinates/reference_time?url=s3%3A%2F%2Fairquality-data-store-develop%2Fnaqfc%2Faqmv7%2Fo3_conus',
        )
    })
    test('answers null for a URL that is not shaped like one', () => {
        expect(coordinatesEndpointFor('https://x/{z}/{x}/{y}.png', 'lead')).toBeNull()
        expect(coordinatesEndpointFor('https://x/tiles/{z}/{x}/{y}?variable=a', 'lead')).toBeNull()
    })
})

test.describe('runs and leads', () => {
    test('newestRuns takes the last n, newest first, ignoring junk', () => {
        expect(newestRuns(['2024-05-14T06:00:00', 7, '', '2024-05-14T12:00:00', '2024-05-15T06:00:00'], 2))
            .toEqual(['2024-05-15T06:00:00', '2024-05-14T12:00:00'])
        expect(newestRuns(null, 3)).toEqual([])
    })
    test('leadRangeOf spans the smallest to largest lead', () => {
        expect(leadRangeOf([1, 2, 3, 72])).toEqual([1, 72])
        expect(leadRangeOf([])).toBeNull()
        expect(leadRangeOf('x')).toBeNull()
    })
    test('runSpan places the run window by lead steps, reading naive ISO as UTC', () => {
        expect(runSpan('2026-09-21T06:00:00', parseStep('PT1H'), [1, 72])).toEqual({
            start: '2026-09-21T07:00:00Z',
            end: '2026-09-24T06:00:00Z',
        })
        expect(runSpan('2026-01-31T00:00:00', parseStep('P1M'), [0, 1])).toEqual({
            start: '2026-01-31T00:00:00Z',
            end: '2026-02-28T00:00:00Z',
        })
        expect(runSpan('nope', parseStep('PT1H'), [1, 2])).toBeNull()
    })
    test('stepsBetween rounds to whole steps', () => {
        expect(stepsBetween(new Date('2026-09-21T06:00:00Z'), new Date('2026-09-22T00:00:00Z'), parseStep('PT1H'))).toBe(18)
        expect(stepsBetween(new Date('2026-09-01T00:00:00Z'), new Date('2026-09-04T11:00:00Z'), parseStep('P1D'))).toBe(3)
    })
})

test.describe('labels', () => {
    test('formatRun names sub-daily runs by hour, daily by day, coarser by month', () => {
        expect(formatRun('2026-09-21T06:00:00', parseStep('PT1H'))).toBe('Sep 21, 06Z')
        expect(formatRun('2026-09-21T00:00:00', parseStep('P1D'))).toBe('Sep 21')
        expect(formatRun('2026-09-01T00:00:00', parseStep('P1M'))).toBe('Sep 2026')
    })
    test('runAge reads in hours under two days, else days', () => {
        const now = new Date('2026-09-21T12:00:00Z')
        expect(runAge('2026-09-21T06:00:00', now)).toBe('6 h ago')
        expect(runAge('2026-09-18T12:00:00', now)).toBe('3 d ago')
    })
    test('formatLead uses the step unit, or the duration itself when compound', () => {
        expect(formatLead(18, parseStep('PT1H'), 'PT1H')).toBe('+18 h')
        expect(formatLead(3, parseStep('P1D'), 'P1D')).toBe('+3 d')
        expect(formatLead(2, parseStep('P1M'), 'P1M')).toBe('+2 mo')
        expect(formatLead(-1, parseStep('PT1H'), 'PT1H')).toBe('-1 h')
        expect(formatLead(4, parseStep('PT6H'), 'PT6H')).toBe('+4 × PT6H')
    })
})

test.describe('readForecastConfig', () => {
    test('an empty block still marks a forecast layer with defaults', () => {
        expect(readForecastConfig({})).toEqual({
            runs: [],
            selectedRun: null,
            leadStep: 'PT1H',
            leadRange: null,
            maxRuns: null,
        })
    })
    test('reads the authored and runtime-written fields', () => {
        expect(readForecastConfig({
            runs: 5,
            leadStep: 'P1D',
            selectedRun: '2026-09-21T06:00:00',
            leadRange: [1, 72],
            runsUrl: 'https://svc/runs',
        })).toEqual({
            runs: [],
            selectedRun: '2026-09-21T06:00:00',
            leadStep: 'P1D',
            leadRange: [1, 72],
            maxRuns: 5,
            runsUrl: 'https://svc/runs',
        })
    })
    test('falls back on a bad step, count, or range', () => {
        const f = readForecastConfig({ leadStep: '1h', runs: 0, leadRange: [1, 'x'] })
        expect(f.leadStep).toBe('PT1H')
        expect(f.maxRuns).toBeNull()
        expect(f.leadRange).toBeNull()
    })
    test('a block switched off in Configure is not a forecast; switched on or unsaid, it is', () => {
        expect(readForecastConfig({ enabled: false, leadStep: 'PT1H' })).toBeNull()
        expect(readForecastConfig({ enabled: true })).not.toBeNull()
        expect(readForecastConfig({ leadStep: 'P1D' })).not.toBeNull()
    })

    test('anything but an object is not a forecast', () => {
        expect(readForecastConfig(undefined)).toBeNull()
        expect(readForecastConfig(true)).toBeNull()
        expect(readForecastConfig('yes')).toBeNull()
    })
})
