import { mmgisRequest, mmgisEmit } from '../../_shared/adapters/mmgisAPI'

type Refresh = () => Promise<void> | void

type LayerConfig = {
    cogTransform?: boolean
    cogColormap?: string
    cogMin?: number
    cogMax?: number
}

export const toggleVisibility = async (layerId: string): Promise<void> => {
    const newVisibility = await mmgisRequest<boolean>('layers:toggle', layerId)
    if (newVisibility !== null) {
        mmgisEmit('layer:visibilityChange', { layerName: layerId, visible: newVisibility })
    }
}

export const setOpacity = async (layerId: string, opacity: number): Promise<void> => {
    const success = await mmgisRequest<boolean>('layers:setOpacity', { layerUUID: layerId, opacity })
    if (success) {
        mmgisEmit('layer:opacityChange', { layerName: layerId, opacity })
    }
}

// Each COG update is a multi-step round trip, so two rapid changes to the same
// layer — easy to trigger by clicking down a list of ramps — can interleave and
// leave the map painting the earlier choice. Every call claims a ticket for its
// layer and abandons its remaining steps once a later one has claimed the same
// layer, making the last click the one that wins.
// Colormap and rescale are tracked separately so that changing one never
// abandons an in-flight change to the other.
const cogTickets = new Map<string, number>()

const claimCogTicket = (kind: string, layerId: string): (() => boolean) => {
    const key = `${kind}:${layerId}`
    const ticket = (cogTickets.get(key) ?? 0) + 1
    cogTickets.set(key, ticket)
    return () => cogTickets.get(key) === ticket
}

export const setColormap = async (layerId: string, colormap: string, refresh: Refresh): Promise<void> => {
    const isCurrent = claimCogTicket('colormap', layerId)
    const cfg = await mmgisRequest<LayerConfig>('layers:getConfig', layerId)
    if (!cfg || !cfg.cogTransform || !isCurrent()) return
    await mmgisRequest('layers:updateConfig', { layerUUID: layerId, updates: { currentCogColormap: colormap } })
    if (!isCurrent()) return
    await mmgisRequest('layers:refresh', { layerUUID: layerId, options: { currentCogColormap: colormap } })
    if (!isCurrent()) return
    mmgisEmit('layer:cogColormapChange', { layerName: layerId, colormap })
    await refresh()
}

export const setRescale = async (
    layerId: string,
    min: number,
    max: number,
    refresh: Refresh,
): Promise<void> => {
    const isCurrent = claimCogTicket('rescale', layerId)
    const cfg = await mmgisRequest<LayerConfig>('layers:getConfig', layerId)
    if (!cfg || !cfg.cogTransform || !isCurrent()) return
    await mmgisRequest('layers:updateConfig', { layerUUID: layerId, updates: { currentCogMin: min, currentCogMax: max } })
    if (!isCurrent()) return
    await mmgisRequest('layers:refresh', { layerUUID: layerId, options: { currentCogMin: min, currentCogMax: max } })
    if (!isCurrent()) return
    mmgisEmit('layer:cogRescaleChange', { layerName: layerId, min, max })
    await refresh()
}

