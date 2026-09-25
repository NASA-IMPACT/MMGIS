// The export band borrows the app theme's typeface, ink and hairline colors
// so a downloaded PNG/PDF reads as part of the same product. A canvas can't
// resolve CSS custom properties itself, so the tokens are read off :root once
// per export and handed to the renderer as plain values. The band's surface
// stays white regardless of theme: the export is a printable artifact.

export type BandTheme = {
    family: string
    /** Titles and row names. */
    ink: string
    /** Dates, metadata, bounds and category labels. */
    muted: string
    /** The divider between header and rows, and the edge on near-white
     *  swatches. */
    hairline: string
    surface: string
    weights: { light: string; regular: string; semibold: string }
}

export const DEFAULT_BAND_THEME: BandTheme = {
    family: '"Public Sans Web", "Public Sans", "Helvetica Neue", Arial, sans-serif',
    ink: '#1b1b1b',
    muted: '#565c65',
    hairline: '#dfe1e2',
    surface: '#ffffff',
    weights: { light: '300', regular: '400', semibold: '600' },
}

/** Reads the theme tokens off `root`, falling back per token to the default
 *  theme's value for any the page doesn't define. */
export const resolveBandTheme = (
    root: Element | null = typeof document !== 'undefined'
        ? document.documentElement
        : null,
): BandTheme => {
    if (!root || typeof getComputedStyle !== 'function') {
        return DEFAULT_BAND_THEME
    }
    const style = getComputedStyle(root)
    const token = (name: string, fallback: string): string =>
        style.getPropertyValue(name).trim() || fallback
    const d = DEFAULT_BAND_THEME
    return {
        family: token('--theme-font-ui', d.family),
        ink: token('--theme-color-ink', d.ink),
        muted: token('--theme-color-base-dark', d.muted),
        hairline: token('--theme-color-base-lighter', d.hairline),
        surface: d.surface,
        weights: {
            light: token('--theme-font-weight-light', d.weights.light),
            regular: token('--theme-font-weight-normal', d.weights.regular),
            semibold: token('--theme-font-weight-semibold', d.weights.semibold),
        },
    }
}

/**
 * Asks the browser to fetch each weight of the theme face the band draws in.
 * A web font the page hasn't used yet at that weight is not loaded, and a
 * canvas silently substitutes a fallback face rather than waiting for it.
 */
export const loadBandFonts = async (theme: BandTheme): Promise<void> => {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined
    if (!fonts?.load) return
    const { light, regular, semibold } = theme.weights
    await Promise.all(
        [light, regular, semibold].map((weight) =>
            fonts.load(`${weight} 12px ${theme.family}`).catch(() => []),
        ),
    )
}
