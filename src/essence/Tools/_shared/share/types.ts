// The three things the share panel can produce. 'link' is always available;
// 'png' and 'pdf' are gated by per-dashboard config.
export type ShareActionKind = 'link' | 'png' | 'pdf'

// Which downloadable formats are enabled (the link is always enabled).
// Intentionally mirrors (but is kept separate from) adapters/shareConfig's
// ShareFormats: lib is the portable presentational layer and must not import
// from the MMGIS-coupled adapters, so it owns its own shape at that boundary.
export type ShareFormatFlags = {
    png: boolean
    pdf: boolean
}
