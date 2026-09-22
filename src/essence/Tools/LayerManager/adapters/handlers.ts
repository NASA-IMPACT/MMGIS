import {
    mmgisRequest,
    mmgisEmit,
    mmgisShowPlugin,
    mmgisGetLayerCogCapabilities,
    mmgisGetLayerBounds,
    mmgisFitBounds,
    mmgisGetLayerOrder,
    mmgisSetLayerOrder,
    mmgisGetVisibleLayers,
    mmgisGetListedLayers,
    mmgisGetLayerConfigs,
    mmgisGetTimeCurrent,
    mmgisGetTimeStart,
    mmgisGetTimeEnd,
} from '../../_shared/adapters/mmgisAPI'
import {
    ZOOM_TO_LAYER_PADDING,
    ZOOM_TO_LAYER_POINT_MAX_ZOOM,
} from '../lib/utils/constants'
import { placeInOrder } from '../lib/utils/layerOrder'
import { filteredOutLayers } from '../lib/utils/filteredOut'
import { parseStep, runSpan, parseUtc, toIso, DEFAULT_LEAD_STEP } from '../lib/utils/forecast'
import { fetchForecastRuns, type RunsAndLeads } from './forecastRuns'
import type { ForecastData } from '../lib/types'

type Refresh = () => Promise<void> | void

/**
 * Whether core accepts a colormap or rescale change for this layer, by its
 * config shape and tile source. The same verdict makes the controls editable
 * in the legend, so a write is only sent for a layer core can recompile.
 */
const canChangeColormap = async (layerId: string): Promise<boolean> => {
    const capabilities = await mmgisGetLayerCogCapabilities(layerId)
    return capabilities?.canChangeColormap === true
}

export const toggleVisibility = async (layerId: string): Promise<void> => {
    const newVisibility = await mmgisRequest<boolean>('layers:toggle', layerId)
    if (newVisibility !== null) {
        mmgisEmit('layer:visibilityChange', { layerName: layerId, visible: newVisibility })
    }
}

export type FilteredOutLayer = { id: string; title: string }

export const getFilteredOutLayers = async (): Promise<FilteredOutLayer[]> => {
    const [visible, listed, configs] = await Promise.all([
        mmgisGetVisibleLayers(),
        mmgisGetListedLayers(),
        mmgisGetLayerConfigs(),
    ])
    return filteredOutLayers(visible, listed).map((id) => ({
        id,
        title: configs?.[id]?.display_name || id,
    }))
}

// Toggle flips state, so only layers currently on are sent.
export const hideFilteredOutLayers = async (): Promise<void> => {
    for (const { id } of await getFilteredOutLayers()) {
        await toggleVisibility(id)
    }
}

export const DEFAULT_MAX_RUNS = 10

type RunSettings = { leadStep: string; leadRange: [number, number] | null }

// Pins the layer to a run: the run's time fills {reftime}, the lead counts
// from it, and the data times become the run's window so the gate and the
// timeline follow. Only a layer that is on is refreshed.
export const applyRun = async (
    layerId: string,
    run: string,
    { leadStep, leadRange }: RunSettings,
): Promise<boolean> => {
    const config = (await mmgisGetLayerConfigs())?.[layerId] as
        | { time?: Record<string, unknown>; variables?: Record<string, unknown> }
        | undefined
    if (!config) return false
    const step = parseStep(leadStep) ?? parseStep(DEFAULT_LEAD_STEP)!
    const span = leadRange ? runSpan(run, step, leadRange) : null
    const variables = config.variables ?? {}
    const updates: Record<string, unknown> = {
        variables: {
            ...variables,
            forecast: { ...(variables.forecast as object), selectedRun: run, leadRange },
            urlReplacements: {
                ...(variables.urlReplacements as object),
                reftime: { on: 'timeChange', kind: 'value', value: run },
                lead: { on: 'timeChange', kind: 'elapsed', from: run, step: leadStep },
            },
        },
        ...(span ? { time: { ...config.time, dataStartTime: span.start, dataEndTime: span.end } } : {}),
    }
    const ok = await mmgisRequest<boolean>('layers:updateConfig', { layerUUID: layerId, updates })
    if (!ok) return false
    const visible = await mmgisGetVisibleLayers()
    if (visible?.[layerId] === true) await mmgisRequest('layers:refresh', { layerUUID: layerId })
    return true
}

// A user's pick. Beyond applying the run, the clock is moved into the run's
// window when it sits outside it, so the layer has something to draw.
export const selectRun = async (
    layerId: string,
    run: string,
    settings: RunSettings,
    now: Date = new Date(),
): Promise<void> => {
    if (!(await applyRun(layerId, run, settings))) return
    if (!settings.leadRange) return
    const step = parseStep(settings.leadStep) ?? parseStep(DEFAULT_LEAD_STEP)!
    const span = runSpan(run, step, settings.leadRange)
    if (!span) return
    const [current, start, end] = await Promise.all([
        mmgisGetTimeCurrent(),
        mmgisGetTimeStart(),
        mmgisGetTimeEnd(),
    ])
    const at = parseUtc(current)
    const spanStart = parseUtc(span.start)!
    const spanEnd = parseUtc(span.end)!
    if (at && at >= spanStart && at <= spanEnd) return
    const next = now >= spanStart && now <= spanEnd ? now : spanStart
    const windowStart = parseUtc(start)
    const windowEnd = parseUtc(end)
    await mmgisRequest('time:set', {
        startTime: toIso(windowStart && windowStart < spanStart ? windowStart : spanStart),
        endTime: toIso(windowEnd && windowEnd > spanEnd ? windowEnd : spanEnd),
        currentTime: toIso(next),
    })
}

// Reads a forecast layer's runs and leads, and pins it to the newest run when
// nothing has been picked yet, so it never asks for tiles with no run.
export const ensureRunSelected = async (
    layerId: string,
    source: { url?: string },
    forecast: ForecastData,
    defaultMaxRuns: number = DEFAULT_MAX_RUNS,
): Promise<RunsAndLeads> => {
    const found = await fetchForecastRuns(
        layerId,
        { url: source.url, runsUrl: forecast.runsUrl, leadUrl: forecast.leadUrl },
        forecast.maxRuns ?? defaultMaxRuns,
    )
    const leadRange = found.leadRange ?? forecast.leadRange
    if (!forecast.selectedRun && found.runs[0]) {
        await applyRun(layerId, found.runs[0], { leadStep: forecast.leadStep, leadRange })
    }
    return { runs: found.runs, leadRange }
}

export const setOpacity = async (layerId: string, opacity: number): Promise<void> => {
    const success = await mmgisRequest<boolean>('layers:setOpacity', { layerUUID: layerId, opacity })
    if (success) {
        mmgisEmit('layer:opacityChange', { layerName: layerId, opacity })
    }
}

/**
 * Moves the map to a layer's extent.
 *
 * Does nothing for a layer with no extent to move to. The menu offering this
 * asks core for the same bounds when it opens and disables the item in that
 * case, so the check here is what keeps a stale menu from moving the map
 * somewhere arbitrary.
 *
 * The fit is capped only for an extent enclosing no area. Anything with area
 * fits as far in as it goes, so a layer covering a few hundred metres is not
 * held back to the zoom a point layer needs.
 */
export const zoomToLayer = async (layerId: string): Promise<void> => {
    const bounds = await mmgisGetLayerBounds(layerId)
    if (bounds === null) {
        // Reachable only when the layer lost its extent between the menu
        // resolving it and the click. The panel has no channel for saying so,
        // which leaves the log as the sole trace of a click that led nowhere.
        console.warn(`LayerManager: '${layerId}' has no extent to zoom to`)
        return
    }
    const [[south, west], [north, east]] = bounds
    const enclosesNoArea = south === north && west === east
    await mmgisFitBounds(bounds, {
        padding: ZOOM_TO_LAYER_PADDING,
        ...(enclosesNoArea ? { maxZoom: ZOOM_TO_LAYER_POINT_MAX_ZOOM } : {}),
    })
}

// One order write at a time. A second move before core's broadcast has
// re-sorted the list would move from a stale picture, so it is dropped.
let orderWriteInFlight = false

// Reads the order from core, lets `place` compute the new one (null when
// there is nowhere to go), and hands it back. Core broadcasts the new order,
// which is what re-sorts the list; nothing to emit here. Core refuses
// exactly when this side's picture of the stack is stale, so a refusal is
// the moment to re-read it.
const writeOrder = async (
    layerId: string,
    place: (order: string[]) => string[] | null,
    refresh?: Refresh,
): Promise<void> => {
    if (orderWriteInFlight) return
    orderWriteInFlight = true
    try {
        const order = await mmgisGetLayerOrder()
        if (order === null) return
        const next = place(order)
        if (next === null) return
        const accepted = await mmgisSetLayerOrder(next)
        if (accepted === false) {
            console.warn(`LayerManager: core refused the new order for '${layerId}'`)
            await refresh?.()
        }
    } finally {
        orderWriteInFlight = false
    }
}

/** Drops a dragged layer at `toIndex` of the list the user dragged it through. */
export const dropLayer = (
    layerId: string,
    toIndex: number,
    shownIds: string[],
    refresh?: Refresh,
): Promise<void> =>
    writeOrder(layerId, (order) => placeInOrder(order, shownIds, layerId, toIndex), refresh)

/**
 * Hands a layer to the Comparison plugin as the first of the two sides it
 * swipes between. A mission without that plugin has nobody listening.
 */
export const compareLayer = (layerId: string): void => {
    mmgisEmit('plugin:comparison:startWithLayer', { layerId })
}

export const ADD_LAYER_PLUGIN_ID = 'AddTempLayerTool'

/** Reveals the "add layer from URL" form. */
export const showAddLayer = (): void => {
    // Widened from CommandResult: without strictNullChecks a boolean
    // discriminant does not narrow, so `reason` is unreachable on the union.
    mmgisShowPlugin(ADD_LAYER_PLUGIN_ID)
        .then((result: { ok: boolean; reason?: string }) => {
            if (!result.ok) {
                console.warn(`LayerManager: showAddLayer refused: ${result.reason}`)
            }
        })
        .catch((err) => console.warn('LayerManager: showAddLayer failed', err))
}

export const setColormap = async (layerId: string, colormap: string, refresh: Refresh): Promise<void> => {
    if (!(await canChangeColormap(layerId))) return
    await mmgisRequest('layers:updateConfig', { layerUUID: layerId, updates: { currentCogColormap: colormap } })
    // applyCogFieldsToUrl prefers `currentCogColormap` over the mission-configured
    // `cogColormap`, so the override key has to match the config write above.
    await mmgisRequest('layers:refresh', { layerUUID: layerId, options: { currentCogColormap: colormap } })
    mmgisEmit('layer:cogColormapChange', { layerName: layerId, colormap })
    await refresh()
}

export const setRescale = async (
    layerId: string,
    min: number,
    max: number,
    refresh: Refresh,
): Promise<void> => {
    if (!(await canChangeColormap(layerId))) return
    await mmgisRequest('layers:updateConfig', { layerUUID: layerId, updates: { currentCogMin: min, currentCogMax: max } })
    await mmgisRequest('layers:refresh', { layerUUID: layerId, options: { currentCogMin: min, currentCogMax: max } })
    mmgisEmit('layer:cogRescaleChange', { layerName: layerId, min, max })
    await refresh()
}

