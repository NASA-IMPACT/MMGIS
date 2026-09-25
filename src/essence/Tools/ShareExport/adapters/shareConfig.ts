// Pure mapping from the plugin's configured tool variables to the set of
// enabled export formats. The share link is always available; PNG and PDF are
// each toggleable per-dashboard and default to on (so an unset/undefined value
// is treated as enabled, matching the config's defaultChecked: true).
//
// includeLegend resolution lives in _shared/share/resolveIncludeLegend —
// shared with the MapControl adapter, which toggles the same export flag.

export type ShareToolVars = {
    exportPng?: boolean
    exportPdf?: boolean
    includeLegend?: boolean
}

// Structurally identical to lib/types' ShareFormatFlags by design: the adapter
// layer keeps its own type rather than importing from lib, preserving the
// portable presentational lib as the only direction of dependency.
export type ShareFormats = {
    png: boolean
    pdf: boolean
}

export function resolveShareFormats(vars?: ShareToolVars | null): ShareFormats {
    const v = vars || {}
    return {
        png: v.exportPng !== false,
        pdf: v.exportPdf !== false,
    }
}
