import { test, expect, describe } from 'vitest'
import {
    formatDateRange,
    buildEntryDisplays,
} from '../../src/essence/Tools/LayerFilter/lib/utils/entryDisplay.ts'

const NOW = Date.parse('2025-07-01T00:00:00Z')

describe('LayerFilter entryDisplay', () => {
    describe('formatDateRange', () => {
        // [start, end, expected]
        const cases = [
            ['2025-01-05T00:00:00Z', '2025-03-31T00:00:00Z', 'Jan 5 – Mar 31, 2025'],
            ['2024-12-01T00:00:00Z', '2025-02-01T00:00:00Z', 'Dec 1, 2024 – Feb 1, 2025'],
            ['2025-06-01T00:00:00Z', null, 'Jun 1, 2025 – present'],
            [null, '2025-03-31T00:00:00Z', ''],
            ['garbage', null, ''],
        ]
        for (const [start, end, expected] of cases) {
            test(`${start} .. ${end} -> "${expected}"`, () => {
                expect(formatDateRange(start, end)).toBe(expected)
            })
        }
    })

    describe('buildEntryDisplays', () => {
        const displays = buildEntryDisplays(
            [
                {
                    id: 'e1',
                    properties: { title: 'Entry One' },
                    start: '2025-01-05T00:00:00Z',
                    end: '2025-03-31T00:00:00Z',
                },
                {
                    id: 'e2',
                    properties: {},
                    start: '2025-06-01T00:00:00Z',
                    end: null,
                },
            ],
            NOW,
        )

        test('title from properties, id as fallback', () => {
            expect(displays.e1.title).toBe('Entry One')
            expect(displays.e2.title).toBe('e2')
        })
        test('year badge from start year', () => {
            expect(displays.e1.yearBadge).toBe('2025')
        })
        test('ended entry is not active; ongoing entry is', () => {
            expect(displays.e1.isActive).toBe(false)
            expect(displays.e2.isActive).toBe(true)
        })
        test('date range renders', () => {
            expect(displays.e1.dateRange).toBe('Jan 5 – Mar 31, 2025')
            expect(displays.e2.dateRange).toBe('Jun 1, 2025 – present')
        })
    })
})
