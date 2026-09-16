// Derived values — computed, never stored (see SCHEMA.md §2).

/** Case-insensitive comparison key. Display strings keep original casing. */
export function casefold(value: unknown): string {
    return String(value ?? '')
        .trim()
        .toLowerCase()
}

/**
 * Every calendar year (UTC) an entry's range touches, as strings.
 * A Dec 2024 – Feb 2025 range yields ['2024', '2025']. An ongoing entry
 * (end null) runs through `now`. Unparseable input yields [].
 */
export function yearSpan(
    start: string | null,
    end: string | null,
    now: number = Date.now(),
): string[] {
    const startMs = start == null ? NaN : Date.parse(start)
    if (Number.isNaN(startMs)) return []
    const endMs = end == null ? now : Date.parse(end)
    if (Number.isNaN(endMs) || endMs < startMs) return []

    const firstYear = new Date(startMs).getUTCFullYear()
    const lastYear = new Date(endMs).getUTCFullYear()
    const years: string[] = []
    for (let y = firstYear; y <= lastYear; y++) years.push(String(y))
    return years
}

/** Ongoing (no end) or not yet ended as of `now`. */
export function isOngoing(end: string | null, now: number = Date.now()): boolean {
    if (end == null) return true
    const endMs = Date.parse(end)
    return Number.isNaN(endMs) ? false : endMs >= now
}
