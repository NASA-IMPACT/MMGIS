// Complement map for `layers:setListed`: every non-header layer gets an
// explicit verdict (matched → listed, everything else → unlisted), so
// clearing filters restores the full list without tracking prior state.

export interface LayerLike {
    type?: unknown
    properties?: Record<string, unknown>
}

export function buildListedUpdates(
    layerConfigs: Record<string, LayerLike> | null | undefined,
    matchedLayerNames: string[],
): Record<string, boolean> {
    const matched = new Set(matchedLayerNames)
    const updates: Record<string, boolean> = {}
    for (const [name, cfg] of Object.entries(layerConfigs || {})) {
        if (cfg?.type === 'header') continue
        updates[name] = matched.has(name)
    }
    return updates
}
