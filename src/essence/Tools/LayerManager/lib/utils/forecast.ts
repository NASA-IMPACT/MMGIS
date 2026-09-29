export type Duration = {
    years: number
    months: number
    weeks: number
    days: number
    hours: number
    minutes: number
    seconds: number
}

const DURATION_RE =
    /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/

export const parseStep = (value: unknown): Duration | null => {
    if (typeof value !== 'string') return null
    const m = DURATION_RE.exec(value)
    if (!m || value === 'P' || value.endsWith('T')) return null
    const [, years, months, weeks, days, hours, minutes, seconds] = m
    if (![years, months, weeks, days, hours, minutes, seconds].some((v) => v)) return null
    return {
        years: Number(years || 0),
        months: Number(months || 0),
        weeks: Number(weeks || 0),
        days: Number(days || 0),
        hours: Number(hours || 0),
        minutes: Number(minutes || 0),
        seconds: Number(seconds || 0),
    }
}

const MS_PER_DAY = 86_400_000
const approximateMs = (d: Duration): number =>
    (d.years * 365.2425 + d.months * 30.436875 + d.weeks * 7 + d.days) * MS_PER_DAY +
    d.hours * 3_600_000 +
    d.minutes * 60_000 +
    d.seconds * 1000

// A naive ISO datetime, as core lists runs, is UTC.
const parseUtc = (value: unknown): Date | null => {
    if (typeof value !== 'string' || value === '') return null
    const iso = /(Z|[+-]\d\d:?\d\d)$/.test(value) ? value : `${value}Z`
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? null : d
}

// Runs are named by their synoptic hour when the model steps sub-daily,
// by day when it steps daily, and by month beyond that.
export const formatRun = (run: string, stepIso: string): string => {
    const d = parseUtc(run)
    if (!d) return run
    const step = parseStep(stepIso)
    const ms = step ? approximateMs(step) : 3_600_000
    const month = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
    if (ms < MS_PER_DAY)
        return `${month} ${d.getUTCDate()}, ${String(d.getUTCHours()).padStart(2, '0')}Z`
    if (ms < 28 * MS_PER_DAY) return `${month} ${d.getUTCDate()}`
    return `${month} ${d.getUTCFullYear()}`
}

export const runAge = (run: string, now: Date): string => {
    const d = parseUtc(run)
    if (!d) return ''
    const hours = Math.max(1, Math.round((now.getTime() - d.getTime()) / 3_600_000))
    return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`
}

const unitLabel = (stepIso: string): string => {
    const d = parseStep(stepIso)
    if (!d) return `× ${stepIso}`
    const parts = [
        [d.years, 'y'], [d.months, 'mo'], [d.weeks, 'w'],
        [d.days, 'd'], [d.hours, 'h'], [d.minutes, 'min'], [d.seconds, 's'],
    ] as const
    const nonZero = parts.filter(([n]) => n > 0)
    return nonZero.length === 1 && nonZero[0][0] === 1 ? nonZero[0][1] : `× ${stepIso}`
}

export const formatLead = (n: number, stepIso: string): string =>
    `${n >= 0 ? '+' : ''}${n} ${unitLabel(stepIso)}`
