/**
 * A theme's icon, resolved from config into the one thing the rail needs to
 * know: whether to draw an image or a Material Design Icons glyph.
 *
 * For `image`, `src` is an https or data URL, a mission-relative upload path,
 * or an asset-bucket key of the shape the upload router writes — the last two
 * resolved by src/pre/uploadKey.ts.
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
