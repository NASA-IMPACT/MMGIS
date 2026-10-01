const QUERY = '(prefers-reduced-motion: reduce)'

/**
 * Whether the viewer has asked for motion to be reduced. The plugin's
 * stylesheets honour the same preference for their own transitions; this is
 * the answer for the animation that runs in script.
 *
 * Read live rather than once, since the preference can change while the page
 * is open. `matchMedia` is missing from some environments, and a query it
 * cannot parse throws in others; either reads as no preference, so the only
 * thing an absent API changes is that motion runs.
 */
export function prefersReducedMotion(): boolean {
    if (typeof window === 'undefined') return false
    if (typeof window.matchMedia !== 'function') return false
    try {
        return window.matchMedia(QUERY).matches === true
    } catch {
        return false
    }
}
