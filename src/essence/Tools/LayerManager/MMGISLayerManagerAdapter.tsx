import React from 'react'
import { useState, useCallback, useEffect, useRef } from 'react'
import { LayerManagerPanel } from './lib'
import type { Layer } from './lib/types'
import { useMMGISEvent } from '../_shared/adapters/useMMGISEvent'
import { useMMGISToolVars } from '../_shared/adapters/useMMGISToolVars'
import { useMMGISHandlerReady } from '../_shared/adapters/useMMGISHandlerReady'
import { getVisibleLayersWithLegends } from './adapters/getVisibleLayersWithLegends'
import { renderDescription } from './adapters/renderDescription'
import {
    toggleVisibility,
    setOpacity,
    setColormap,
    setRescale,
    zoomToLayer,
    compareLayer,
    showAddLayer,
    dropLayer,
    getFilteredOutLayers,
    hideFilteredOutLayers,
} from './adapters/handlers'
import {
    mmgisGetLayerBounds,
    mmgisGetTimeCurrent,
    mmgisOnDataCoverageChanged,
    type LayerDataCoverageChange,
} from '../_shared/adapters/mmgisAPI'

type ToolVars = { showOnlyVisible?: boolean; width?: number }

// Panel controls are event callbacks and cannot await the requests they fire,
// so a rejected one would surface only as an unhandled rejection. Log it
// against the action that produced it instead.
const report = (action: string, result: Promise<void>): void => {
    result.catch((err) => {
        console.error(`LayerManager: ${action} failed`, err)
    })
}

/**
 * The rows with the given layers' no-data flags swapped in, keyed by layer
 * UUID, which both row ids and core's announcements use. The same array when
 * no row is named, so an announcement for another layer re-renders nothing.
 */
const withOutOfRange = (rows: Layer[], flags: Map<string, boolean>): Layer[] => {
    if (!rows.some((row) => flags.has(row.id))) return rows
    return rows.map((row) =>
        flags.has(row.id) ? { ...row, outOfDataRange: flags.get(row.id) } : row,
    )
}

export function MMGISLayerManagerAdapter() {
    const [layers, setLayers] = useState<Layer[]>([])
    const [filteredOut, setFilteredOut] = useState<string[]>([])
    const [loading, setLoading] = useState(true)
    const toolVars = useMMGISToolVars<ToolVars>('layermanager')

    // Coverage changes announced while a refresh is reading, one collection
    // per refresh in flight. A refresh reads every layer's coverage before its
    // rows land, and a change announced in between would otherwise be
    // overwritten by that older read until the layer next changes.
    const inFlight = useRef(new Set<Map<string, boolean>>())

    // Ticks on every refresh, so a call can tell whether it is still the most
    // recent one once its await returns. Without this, an older refresh (a
    // slow custom colormap fetch, say) that resolves after a newer one has
    // already landed would overwrite the newer rows with stale ones.
    const refreshSeq = useRef(0)

    const refresh = useCallback(async () => {
        const seq = ++refreshSeq.current
        const announced = new Map<string, boolean>()
        inFlight.current.add(announced)
        try {
            const [data, leftOut] = await Promise.all([
                getVisibleLayersWithLegends({
                    showOnlyVisible: toolVars.showOnlyVisible === true,
                }),
                getFilteredOutLayers(),
            ])
            // A newer refresh already landed while this one was reading —
            // its answer is stale, so drop it.
            if (seq !== refreshSeq.current) return
            setLayers(withOutOfRange(data, announced))
            setFilteredOut(leftOut.map((layer) => layer.title))
        } catch (err) {
            console.error('LayerManager: refresh failed', err)
            if (seq === refreshSeq.current) {
                setLayers([])
                setFilteredOut([])
            }
        } finally {
            inFlight.current.delete(announced)
            if (seq === refreshSeq.current) setLoading(false)
        }
    }, [toolVars.showOnlyVisible])

    // Core announces a layer's record whenever its verdict or coverage
    // changes, so this keeps each row's warning current between refreshes.
    const applyCoverageChange = useCallback(
        ({ layerName, outOfDataRange }: LayerDataCoverageChange) => {
            if (!layerName) return
            for (const announced of inFlight.current) {
                announced.set(layerName, outOfDataRange)
            }
            setLayers((rows) =>
                withOutOfRange(rows, new Map([[layerName, outOfDataRange]])),
            )
        },
        [],
    )
    useEffect(
        () => mmgisOnDataCoverageChanged(applyCoverageChange),
        [applyCoverageChange],
    )

    // Whether the layer has somewhere to zoom to. Core answers null both for a
    // layer with no extent and for a core too old to know the question, and
    // either way the action leads nowhere.
    const canZoomToLayer = useCallback(async (layerId: string) => {
        return (await mmgisGetLayerBounds(layerId)) !== null
    }, [])

    useMMGISEvent('layer:visibilityChange', refresh)
    useMMGISEvent('layer:refreshStatusChange', refresh)
    useMMGISEvent('layer:opacityChange', refresh)
    useMMGISEvent('layer:listedChange', refresh)
    useMMGISEvent('layers:listChanged', refresh)
    useMMGISEvent('layers:orderChanged', refresh)

    // A drop lands relative to this list, not to the full order.
    const onReorder = useCallback(
        (id: string, toIndex: number) => {
            report('dropLayer', dropLayer(id, toIndex, layers.map((l) => l.id), refresh))
        },
        [layers, refresh],
    )

    // 'layers:getAll' is registered by Layers_.fina() during mission load.
    // Wait for it before doing the initial refresh, otherwise the adapter
    // mounts to an empty list and never recovers (no event fires when the
    // mission's layers first become available).
    useMMGISHandlerReady('layers:getAll', refresh)

    // The timeline's current time, named by the no-data warning.
    const [selectedTime, setSelectedTime] = useState<string | null>(null)
    const readSelectedTime = useCallback(() => {
        mmgisGetTimeCurrent().then(setSelectedTime, () => {})
    }, [])
    useMMGISHandlerReady('time:getCurrent', readSelectedTime)
    const followSelectedTime = useCallback((payload?: unknown) => {
        const { currentTime } = (payload ?? {}) as { currentTime?: string }
        if (currentTime) setSelectedTime(currentTime)
    }, [])
    useMMGISEvent('time:changed', followSelectedTime)

    return (
        <LayerManagerPanel
            layers={layers}
            loading={loading}
            renderDescription={renderDescription}
            onVisibilityChange={(id) => { report('toggleVisibility', toggleVisibility(id)) }}
            onOpacityChange={(id, op) => { report('setOpacity', setOpacity(id, op)) }}
            onColormapChange={(id, cm) => { report('setColormap', setColormap(id, cm, refresh)) }}
            onRescaleChange={(id, mn, mx) => { report('setRescale', setRescale(id, mn, mx, refresh)) }}
            onZoomToLayer={(id) => { report('zoomToLayer', zoomToLayer(id)) }}
            canZoomToLayer={canZoomToLayer}
            selectedTime={selectedTime}
            onCompareLayer={compareLayer}
            onReorder={onReorder}
            onAddLayer={showAddLayer}
            onHideFilteredLayers={() => { report('hideFilteredOutLayers', hideFilteredOutLayers()) }}
            filteredOutLayers={filteredOut}
        />
    )
}
