// Presentation data for catalogue entries (the pick-one control): title,
// year badge, human date range, active state. Pure derivation — nothing
// here is stored (SCHEMA.md §2).

import type { CatalogEntry } from '../engine/types'
import { isOngoing } from '../engine/derive'

export interface EntryDisplay {
    id: string
    title: string
    /** Start year, shown as the option's chip (e.g. "2025"). */
    yearBadge: string
    /** e.g. "Jan 5 – Mar 31, 2025", "Dec 1, 2024 – Feb 1, 2025", "Jun 1, 2025 – present". */
    dateRange: string
    isActive: boolean
}

const MONTH_DAY = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
})
const MONTH_DAY_YEAR = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
})

export function formatDateRange(start: string | null, end: string | null): string {
    const startMs = start == null ? NaN : Date.parse(start)
    if (Number.isNaN(startMs)) return ''
    const startDate = new Date(startMs)

    const endMs = end == null ? NaN : Date.parse(end)
    if (Number.isNaN(endMs)) {
        return `${MONTH_DAY_YEAR.format(startDate)} – present`
    }
    const endDate = new Date(endMs)
    if (startDate.getUTCFullYear() === endDate.getUTCFullYear()) {
        return `${MONTH_DAY.format(startDate)} – ${MONTH_DAY_YEAR.format(endDate)}`
    }
    return `${MONTH_DAY_YEAR.format(startDate)} – ${MONTH_DAY_YEAR.format(endDate)}`
}

export function buildEntryDisplays(
    entries: CatalogEntry[],
    now: number = Date.now(),
): Record<string, EntryDisplay> {
    const byId: Record<string, EntryDisplay> = {}
    for (const entry of entries) {
        const startMs = entry.start == null ? NaN : Date.parse(entry.start)
        byId[entry.id] = {
            id: entry.id,
            title:
                typeof entry.properties.title === 'string' &&
                entry.properties.title !== ''
                    ? entry.properties.title
                    : entry.id,
            yearBadge: Number.isNaN(startMs)
                ? ''
                : String(new Date(startMs).getUTCFullYear()),
            dateRange: formatDateRange(entry.start, entry.end),
            isActive: entry.start != null && isOngoing(entry.end, now),
        }
    }
    return byId
}
