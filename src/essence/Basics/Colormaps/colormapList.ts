// Reading the ramp names a tiling service lists at `/colorMaps`.
//
// This module has no imports, so a Node script can load it directly
// (scripts/colormaps.mjs) without a bundler.

export type ColormapListResponse = {
    // TiTiler <= 0.22 reports a flat array of names under `colorMaps`.
    colorMaps?: unknown
    // Later releases spell the key `colormaps` and carry each ramp as an
    // object holding its name and links.
    colormaps?: unknown
}

/**
 * Read a ramp-name list out of a `/colorMaps` payload. The endpoint's shape
 * varies across TiTiler releases — a flat array of names, or entries carrying
 * the name under `id`/`name` — so accept either rather than pinning to one
 * deployment's version. Returns null when nothing recognizable is present.
 */
export const parseColormapList = (data: unknown): string[] | null => {
    if (data == null || typeof data !== 'object') return null
    const payload = data as ColormapListResponse
    const raw = payload.colorMaps ?? payload.colormaps
    if (!Array.isArray(raw)) return null

    const names = raw
        .map((entry): string | null => {
            if (typeof entry === 'string') return entry
            if (entry && typeof entry === 'object') {
                const record = entry as Record<string, unknown>
                const id = record.id ?? record.name
                if (typeof id === 'string') return id
            }
            return null
        })
        .filter((name): name is string => name != null && name.length > 0)

    return names.length > 0 ? names : null
}
