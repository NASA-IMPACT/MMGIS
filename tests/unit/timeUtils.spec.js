import { describe, it, expect } from 'vitest'
import {
    parseTimeWithOffset,
    parseTimeToSeconds,
} from '../../src/essence/Basics/TimeControl_/timeUtils'

describe('parseTimeWithOffset', () => {
    it('returns the input unchanged when there is no offset suffix', () => {
        expect(parseTimeWithOffset('2024-01-01T00:00:00Z')).toEqual({
            dateString: '2024-01-01T00:00:00Z',
            additionalSeconds: 0,
        })
    })

    it('parses a positive offset', () => {
        expect(parseTimeWithOffset('2024-01-01T00:00:00Z + 3600')).toEqual({
            dateString: '2024-01-01T00:00:00Z',
            additionalSeconds: 3600,
        })
    })

    it('parses a negative offset', () => {
        expect(parseTimeWithOffset('2024-01-01T00:00:00Z - 1800')).toEqual({
            dateString: '2024-01-01T00:00:00Z',
            additionalSeconds: -1800,
        })
    })

    it('parses an offset on the "now" keyword', () => {
        expect(parseTimeWithOffset('now - 86400')).toEqual({
            dateString: 'now',
            additionalSeconds: -86400,
        })
    })

    it('treats a non-numeric offset as 0', () => {
        expect(parseTimeWithOffset('2024-01-01T00:00:00Z + abc')).toEqual({
            dateString: '2024-01-01T00:00:00Z',
            additionalSeconds: 0,
        })
    })

    it('passes non-string input through', () => {
        expect(parseTimeWithOffset(null)).toEqual({
            dateString: null,
            additionalSeconds: 0,
        })
        const d = new Date(0)
        expect(parseTimeWithOffset(d)).toEqual({
            dateString: d,
            additionalSeconds: 0,
        })
    })
})

describe('parseTimeToSeconds', () => {
    it('parses hh:mm:ss', () => {
        expect(parseTimeToSeconds('01:30:00')).toBe(5400)
        expect(parseTimeToSeconds('00:00:30')).toBe(30)
    })

    it('parses negative hh:mm:ss', () => {
        expect(parseTimeToSeconds('-02:00:00')).toBe(-7200)
    })

    it('parses plain seconds as string or number', () => {
        expect(parseTimeToSeconds('3600')).toBe(3600)
        expect(parseTimeToSeconds(3600)).toBe(3600)
        expect(parseTimeToSeconds(-60)).toBe(-60)
    })

    it('returns 0 for null/undefined', () => {
        expect(parseTimeToSeconds(null)).toBe(0)
        expect(parseTimeToSeconds(undefined)).toBe(0)
    })
})
