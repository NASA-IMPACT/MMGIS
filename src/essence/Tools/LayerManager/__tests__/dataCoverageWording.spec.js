import { describe, test, expect } from 'vitest'
import { describeDataCoverage } from '../lib/utils/dataCoverageWording.ts'

/**
 * The popover's words for a layer's coverage record. All times are UTC, and a
 * listed entry is named at the unit core says it names — never at a precision
 * guessed from how long its span is.
 */

const utc = (...parts) => Date.UTC(...parts)

/** The last millisecond of a UTC day, which is where a day-closing bound sits. */
const endOfDay = (y, m, d) => utc(y, m, d + 1) - 1

const continuous = (start, end, window = null) => ({
    outOfDataRange: true,
    kind: 'continuous',
    spans: [{ start, end }],
    requestedWindow: window,
})

const sparse = (spans, window = null) => ({
    outOfDataRange: true,
    kind: 'sparse',
    spans,
    requestedWindow: window,
})

const yearEntry = (y) => ({
    start: utc(y, 0, 1),
    end: utc(y + 1, 0, 1) - 1,
    at: utc(y, 0, 1),
    unit: 'year',
})
const monthEntry = (y, m) => ({
    start: utc(y, m, 1),
    end: utc(y, m + 1, 1) - 1,
    at: utc(y, m, 1),
    unit: 'month',
})
const dayEntry = (y, m, d) => ({
    start: utc(y, m, d),
    end: endOfDay(y, m, d),
    at: utc(y, m, d),
    unit: 'day',
})
const hourEntry = (y, m, d, h, min = 0) => ({
    start: utc(y, m, d, h),
    end: utc(y, m, d, h + 1) - 1,
    at: utc(y, m, d, h, min),
    unit: 'hour',
})

describe('describeDataCoverage', () => {
    test('titles every constrained record the same way', () => {
        expect(
            describeDataCoverage(continuous(utc(2020, 0, 1), endOfDay(2020, 2, 1)))
                .title,
        ).toBe('No data at this time')
        expect(describeDataCoverage(sparse([yearEntry(2020)])).title).toBe(
            'No data at this time',
        )
    })

    describe('continuous coverage', () => {
        test('names both bounds by day when each falls on a day boundary', () => {
            expect(
                describeDataCoverage(
                    continuous(utc(2020, 0, 1), endOfDay(2020, 2, 1)),
                ).coverage,
            ).toBe('Data available 2020-01-01 to 2020-03-01')
        })

        test('names an open start as "until"', () => {
            expect(
                describeDataCoverage(continuous(-Infinity, endOfDay(2020, 2, 1)))
                    .coverage,
            ).toBe('Data available until 2020-03-01')
        })

        test('names an open end as "from"', () => {
            expect(
                describeDataCoverage(continuous(utc(2020, 0, 1), Infinity))
                    .coverage,
            ).toBe('Data available from 2020-01-01')
        })

        test('adds the time of day only to a bound off a day boundary', () => {
            expect(
                describeDataCoverage(
                    continuous(utc(2020, 0, 1, 6), utc(2020, 2, 1, 13) - 1),
                ).coverage,
            ).toBe('Data available 2020-01-01 06:00 UTC to 2020-03-01 12:59 UTC')
            expect(
                describeDataCoverage(
                    continuous(utc(2020, 0, 1, 6), endOfDay(2020, 2, 1)),
                ).coverage,
            ).toBe('Data available 2020-01-01 06:00 UTC to 2020-03-01')
        })

        test('has no coverage to name when both bounds are open', () => {
            expect(
                describeDataCoverage(continuous(-Infinity, Infinity)).coverage,
            ).toBeNull()
        })
    })

    describe('a single listed entry, named at its own unit', () => {
        test('year', () => {
            expect(describeDataCoverage(sparse([yearEntry(2020)])).coverage).toBe(
                'Data available in 2020',
            )
        })

        test('month', () => {
            expect(
                describeDataCoverage(sparse([monthEntry(2020, 2)])).coverage,
            ).toBe('Data available in March 2020')
        })

        test('day', () => {
            expect(
                describeDataCoverage(sparse([dayEntry(2020, 2, 4)])).coverage,
            ).toBe('Data available on 2020-03-04')
        })

        test('hour', () => {
            expect(
                describeDataCoverage(sparse([hourEntry(2020, 2, 4, 14)])).coverage,
            ).toBe('Data available on 2020-03-04 at 14:00 UTC')
        })

        // Listed as 14:30, the entry covers 14:00–14:59. It is named by the
        // timestamp as listed, not by the start of the hour it falls in.
        test('an hour entry written to the minute keeps its minutes', () => {
            expect(
                describeDataCoverage(sparse([hourEntry(2020, 2, 4, 14, 30)]))
                    .coverage,
            ).toBe('Data available on 2020-03-04 at 14:30 UTC')
        })

        // The same span called a month and called a day: only the unit
        // decides how it reads.
        test('reads the unit, never the length of the span', () => {
            const span = monthEntry(2020, 1)
            expect(describeDataCoverage(sparse([span])).coverage).toBe(
                'Data available in February 2020',
            )
            expect(
                describeDataCoverage(sparse([{ ...span, unit: 'day' }])).coverage,
            ).toBe('Data available on 2020-02-01')
            expect(
                describeDataCoverage(sparse([{ ...span, unit: 'year' }])).coverage,
            ).toBe('Data available in 2020')
        })

        test('names every month in English', () => {
            const names = Array.from({ length: 12 }, (_, m) =>
                describeDataCoverage(sparse([monthEntry(2021, m)])).coverage,
            )
            expect(names).toEqual([
                'Data available in January 2021',
                'Data available in February 2021',
                'Data available in March 2021',
                'Data available in April 2021',
                'Data available in May 2021',
                'Data available in June 2021',
                'Data available in July 2021',
                'Data available in August 2021',
                'Data available in September 2021',
                'Data available in October 2021',
                'Data available in November 2021',
                'Data available in December 2021',
            ])
        })
    })

    describe('several listed entries', () => {
        test('counts them and names the first and last at their own units', () => {
            const spans = [
                monthEntry(2020, 2),
                ...Array.from({ length: 10 }, (_, i) => dayEntry(2020, 4, i + 1)),
                dayEntry(2020, 10, 30),
            ]
            expect(spans).toHaveLength(12)
            expect(describeDataCoverage(sparse(spans)).coverage).toBe(
                'Data available for 12 listed periods, March 2020 to 2020-11-30',
            )
        })

        // Ordered by start, the day would come last, though the year it sits
        // in runs on past it. The range closes on whichever entry ends last.
        test('closes on the entry that ends last, not the one that starts last', () => {
            expect(
                describeDataCoverage(
                    sparse([yearEntry(2019), yearEntry(2020), dayEntry(2020, 2, 4)]),
                ).coverage,
            ).toBe('Data available for 3 listed periods, 2019 to 2020')
        })

        test('names one entry holding all the others alone', () => {
            expect(
                describeDataCoverage(sparse([yearEntry(2020), dayEntry(2020, 2, 4)]))
                    .coverage,
            ).toBe('Data available for 2 listed periods in 2020')
            expect(
                describeDataCoverage(
                    sparse([
                        dayEntry(2020, 2, 4),
                        hourEntry(2020, 2, 4, 9),
                        hourEntry(2020, 2, 4, 14, 30),
                    ]),
                ).coverage,
            ).toBe('Data available for 3 listed periods on 2020-03-04')
        })

        // Several entries can share the earliest start or the latest end; the
        // narrowest of them names that end of the range most exactly.
        test('names the narrowest entry at either end where they tie', () => {
            expect(
                describeDataCoverage(
                    sparse([
                        dayEntry(2019, 0, 1),
                        monthEntry(2019, 0),
                        yearEntry(2019),
                        monthEntry(2020, 11),
                        yearEntry(2020),
                        dayEntry(2020, 11, 31),
                    ]),
                ).coverage,
            ).toBe('Data available for 6 listed periods, 2019-01-01 to 2020-12-31')
        })

        test('reads the entries in any order', () => {
            expect(
                describeDataCoverage(
                    sparse([dayEntry(2020, 10, 30), monthEntry(2020, 2)]),
                ).coverage,
            ).toBe('Data available for 2 listed periods, March 2020 to 2020-11-30')
        })

        test('names a year first and an hour last', () => {
            expect(
                describeDataCoverage(
                    sparse([yearEntry(2019), hourEntry(2020, 10, 30, 14, 30)]),
                ).coverage,
            ).toBe(
                'Data available for 2 listed periods, 2019 to 2020-11-30 14:30 UTC',
            )
        })
    })

    describe('the requested instant', () => {
        test("is the requested window's end", () => {
            const window = { start: utc(2020, 3, 14), end: utc(2020, 3, 15, 14) }
            expect(
                describeDataCoverage(sparse([dayEntry(2020, 2, 4)], window)).instant,
            ).toBe('Requested 2020-04-15 14:00 UTC')
        })

        test('is named by day alone at midnight', () => {
            const window = { start: utc(2020, 3, 14), end: utc(2020, 3, 15) }
            expect(
                describeDataCoverage(sparse([dayEntry(2020, 2, 4)], window)).instant,
            ).toBe('Requested 2020-04-15')
        })

        test('keeps seconds that are there', () => {
            const window = {
                start: utc(2020, 3, 14),
                end: utc(2020, 3, 15, 14, 23, 7),
            }
            expect(
                describeDataCoverage(sparse([dayEntry(2020, 2, 4)], window)).instant,
            ).toBe('Requested 2020-04-15 14:23:07 UTC')
        })

        test('is absent when the record has no window', () => {
            const wording = describeDataCoverage(sparse([dayEntry(2020, 2, 4)]))
            expect(wording.instant).toBeNull()
            expect(wording.coverage).toBe('Data available on 2020-03-04')
        })
    })

    // The panel words a record on every render, so a malformed one costs only
    // its own words and never throws.
    describe('malformed records', () => {
        const day = dayEntry(2020, 2, 4)

        test('skips a listed entry with no timestamp to name', () => {
            expect(
                describeDataCoverage(
                    sparse([
                        { ...day, at: NaN },
                        { start: -Infinity, end: 0, unit: 'day' },
                        { ...day, at: 1e20 },
                        null,
                        '2020-03-05',
                        42,
                        dayEntry(2020, 2, 6),
                    ]),
                ).coverage,
            ).toBe('Data available on 2020-03-06')
        })

        test('has nothing to word when no listed entry can be named', () => {
            expect(
                describeDataCoverage(sparse([{ ...day, at: NaN }, null])),
            ).toBeNull()
        })

        test('has nothing to word without a list of spans', () => {
            expect(describeDataCoverage({ ...sparse([]), spans: day })).toBeNull()
            expect(describeDataCoverage({ ...sparse([]), spans: '2020' })).toBeNull()
            expect(
                describeDataCoverage({ ...continuous(0, 1), spans: { 0: day } }),
            ).toBeNull()
        })

        test('has nothing to word for an extent with an unreadable bound', () => {
            expect(describeDataCoverage(continuous(NaN, endOfDay(2020, 2, 1)))).toBeNull()
            expect(describeDataCoverage(continuous(utc(2020, 0, 1), '2020'))).toBeNull()
            expect(describeDataCoverage(continuous(utc(2020, 0, 1), 1e20))).toBeNull()
            expect(
                describeDataCoverage({ ...continuous(0, 1), spans: [null] }),
            ).toBeNull()
        })

        test('has nothing to word for a kind it does not know', () => {
            expect(describeDataCoverage({ ...sparse([day]), kind: 'weekly' })).toBeNull()
        })

        test('leaves out an instant it cannot read', () => {
            for (const requestedWindow of [
                { start: 0, end: NaN },
                { start: 0, end: 1e20 },
                { start: 0, end: '2020-04-02' },
                'soon',
                42,
            ]) {
                const wording = describeDataCoverage(sparse([day], requestedWindow))
                expect(wording.instant).toBeNull()
                expect(wording.coverage).toBe('Data available on 2020-03-04')
            }
        })

        test('never throws', () => {
            const records = [
                'record',
                42,
                [],
                { kind: 'sparse' },
                { kind: 'sparse', spans: [undefined, [], () => {}] },
                { kind: 'continuous', spans: [] },
                { kind: 'continuous', spans: [{}] },
                { kind: 'sparse', spans: [{ at: Infinity }, { start: NaN }] },
            ]
            for (const record of records) {
                expect(() => describeDataCoverage(record)).not.toThrow()
            }
        })
    })

    describe('records with nothing to word', () => {
        test('no record', () => {
            expect(describeDataCoverage(null)).toBeNull()
            expect(describeDataCoverage(undefined)).toBeNull()
        })

        test('a layer that declares no coverage', () => {
            expect(
                describeDataCoverage({
                    outOfDataRange: false,
                    kind: null,
                    spans: null,
                    requestedWindow: { start: 0, end: 1 },
                }),
            ).toBeNull()
        })

        test('a sparse record listing nothing', () => {
            expect(describeDataCoverage(sparse([]))).toBeNull()
        })
    })
})
