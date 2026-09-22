import type { ForecastData } from '../types'

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

export const DEFAULT_LEAD_STEP = 'PT1H'

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

// Calendar-aware. Months and years move by date components, with the day
// clamped to the target month's length so Jan 31 + P1M is Feb 28, not Mar 3.
export const addSteps = (date: Date, d: Duration, n: number): Date => {
    const out = new Date(date)
    const day = out.getUTCDate()
    out.setUTCDate(1)
    out.setUTCFullYear(out.getUTCFullYear() + n * d.years)
    out.setUTCMonth(out.getUTCMonth() + n * d.months)
    const monthEnd = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate()
    out.setUTCDate(Math.min(day, monthEnd) + n * (d.days + 7 * d.weeks))
    out.setUTCHours(out.getUTCHours() + n * d.hours)
    out.setUTCMinutes(out.getUTCMinutes() + n * d.minutes)
    out.setUTCSeconds(out.getUTCSeconds() + n * d.seconds)
    return out
}

const MS_PER_DAY = 86_400_000
const approximateMs = (d: Duration): number =>
    (d.years * 365.2425 + d.months * 30.436875 + d.weeks * 7 + d.days) * MS_PER_DAY +
    d.hours * 3_600_000 +
    d.minutes * 60_000 +
    d.seconds * 1000

export const stepsBetween = (from: Date, to: Date, step: Duration): number => {
    const target = to.getTime()
    const distance = (n: number) => Math.abs(addSteps(from, step, n).getTime() - target)
    let n = Math.round((target - from.getTime()) / approximateMs(step))
    while (distance(n + 1) < distance(n)) n++
    while (distance(n - 1) < distance(n)) n--
    return n
}

// A naive ISO datetime, as the coordinates service lists runs, is UTC.
export const parseUtc = (value: unknown): Date | null => {
    if (typeof value !== 'string' || value === '') return null
    const iso = /(Z|[+-]\d\d:?\d\d)$/.test(value) ? value : `${value}Z`
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? null : d
}

export const toIso = (d: Date): string => d.toISOString().split('.')[0] + 'Z'

// `${service}/dataset/coordinates/<name>?url=<first store>` for a
// titiler-multidim tile URL; null when the URL is not shaped like one.
export const coordinatesEndpointFor = (layerUrl: string, coordinate: string): string | null => {
    const tilesAt = layerUrl.indexOf('/tiles/')
    const queryAt = layerUrl.indexOf('?')
    if (tilesAt < 0 || queryAt < 0) return null
    const store = new URLSearchParams(layerUrl.slice(queryAt + 1)).get('url')
    if (!store) return null
    return `${layerUrl.slice(0, tilesAt)}/dataset/coordinates/${coordinate}?url=${encodeURIComponent(store)}`
}

// The service lists runs oldest first; the dropdown wants the newest first.
export const newestRuns = (list: unknown, n: number): string[] => {
    if (!Array.isArray(list)) return []
    const runs = list.filter((v): v is string => typeof v === 'string' && v !== '').sort()
    return runs.slice(Math.max(0, runs.length - n)).reverse()
}

export const leadRangeOf = (list: unknown): [number, number] | null => {
    if (!Array.isArray(list)) return null
    const leads = list.filter((v): v is number => Number.isFinite(v))
    if (leads.length === 0) return null
    return [Math.min(...leads), Math.max(...leads)]
}

export const runSpan = (
    run: string,
    step: Duration,
    leadRange: [number, number],
): { start: string; end: string } | null => {
    const from = parseUtc(run)
    if (!from) return null
    return {
        start: toIso(addSteps(from, step, leadRange[0])),
        end: toIso(addSteps(from, step, leadRange[1])),
    }
}

const isBelow = (d: Duration, ms: number) => approximateMs(d) < ms

// Runs are named by their synoptic hour when the model steps sub-daily,
// by day when it steps daily, and by month beyond that.
export const formatRun = (run: string, step: Duration): string => {
    const d = parseUtc(run)
    if (!d) return run
    const month = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
    if (isBelow(step, MS_PER_DAY))
        return `${month} ${d.getUTCDate()}, ${String(d.getUTCHours()).padStart(2, '0')}Z`
    if (isBelow(step, 28 * MS_PER_DAY)) return `${month} ${d.getUTCDate()}`
    return `${month} ${d.getUTCFullYear()}`
}

export const runAge = (run: string, now: Date): string => {
    const d = parseUtc(run)
    if (!d) return ''
    const hours = Math.max(1, Math.round((now.getTime() - d.getTime()) / 3_600_000))
    return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`
}

const unitLabel = (d: Duration, iso: string): string => {
    const parts = [
        [d.years, 'y'], [d.months, 'mo'], [d.weeks, 'w'],
        [d.days, 'd'], [d.hours, 'h'], [d.minutes, 'min'], [d.seconds, 's'],
    ] as const
    const nonZero = parts.filter(([n]) => n > 0)
    return nonZero.length === 1 && nonZero[0][0] === 1 ? nonZero[0][1] : `× ${iso}`
}

export const formatLead = (n: number, step: Duration, iso: string): string =>
    `${n >= 0 ? '+' : ''}${n} ${unitLabel(step, iso)}`

const isLeadRange = (v: unknown): v is [number, number] =>
    Array.isArray(v) && v.length === 2 && v.every((n) => Number.isFinite(n))

// Config-shaped in, typed out. A block is a forecast unless it says
// enabled: false, which is what Configure writes for a layer whose Forecast
// Layer switch was left off.
export const readForecastConfig = (raw: unknown): ForecastData | null => {
    if (!raw || typeof raw !== 'object') return null
    const f = raw as Record<string, unknown>
    if (f.enabled === false) return null
    return {
        runs: [],
        selectedRun: typeof f.selectedRun === 'string' && f.selectedRun ? f.selectedRun : null,
        leadStep: parseStep(f.leadStep) ? (f.leadStep as string) : DEFAULT_LEAD_STEP,
        leadRange: isLeadRange(f.leadRange) ? f.leadRange : null,
        maxRuns: Number.isInteger(f.runs) && (f.runs as number) > 0 ? (f.runs as number) : null,
        ...(typeof f.runsUrl === 'string' ? { runsUrl: f.runsUrl } : {}),
        ...(typeof f.leadUrl === 'string' ? { leadUrl: f.leadUrl } : {}),
    }
}
