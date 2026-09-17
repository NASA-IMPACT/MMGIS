/**
 * One reading of an ISO instant, for every date rule on the band.
 *
 * The rules compare instants and print them, so each one is read once and
 * carried as both: the milliseconds to compare on, and the text it was
 * written as, so a range prints the dates it was given rather than a
 * rewritten form. Anything that will not parse is not an instant at all,
 * which is what lets a caller tell "no bound" from "a bound nobody can read".
 */

export type Instant = { text: string; ms: number }

export const parseInstant = (
    value: string | null | undefined,
): Instant | null => {
    if (typeof value !== 'string') return null
    const ms = Date.parse(value)
    return Number.isNaN(ms) ? null : { text: value, ms }
}
