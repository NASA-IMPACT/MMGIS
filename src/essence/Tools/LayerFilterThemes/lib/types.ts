/**
 * A theme's icon, resolved from config into the one thing the rail needs to
 * know: whether to draw an image or a Material Design Icons glyph.
 *
 * `image` covers both an uploaded file (a mission-relative path from the
 * Configure upload field) and a link to one hosted elsewhere.
 */
export type ThemeIcon =
    | { kind: 'image'; src: string }
    | { kind: 'mdi'; name: string }

/** The rail only needs each theme's id + how to label/icon it. */
export interface ThemeSummary {
    id: string
    label: string
    icon?: ThemeIcon
}
