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
} from './adapters/handlers'
import {
    mmgisGetLayerBounds,
    mmgisGetLayerDataCoverage,
    mmgisOnDataCoverageChanged,
    type LayerDataCoverage,
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
 * The rows with the given layers' coverage records swapped in, keyed by layer
 * UUID — which is what both row ids and core's announcements use. The same
 * array when no row is named, so an announcement for a layer the list does
 * not hold re-renders nothing.
 */
const withCoverage = (
    rows: Layer[],
    records: Map<string, LayerDataCoverage>,
): Layer[] => {
    if (!rows.some((row) => records.has(row.id))) return rows
    return rows.map((row) =>
        records.has(row.id)
            ? { ...row, dataCoverage: records.get(row.id) }
            : row,
    )
}

// Module scope keeps the handler stable, so the subscription is made once.
const zoomWhenShown = (payload?: unknown): void => {
    const { layerName, visible } = (payload ?? {}) as { layerName?: string; visible?: boolean }
    if (visible === true && layerName) report('zoomToLayer', zoomToLayer(layerName))
}

export function MMGISLayerManagerAdapter() {
    const [layers, setLayers] = useState<Layer[]>([])
    const [loading, setLoading] = useState(true)
    const toolVars = useMMGISToolVars<ToolVars>('layermanager')

    // Coverage changes announced while a refresh is reading, one collection
    // per refresh in flight. A refresh reads every layer's coverage before its
    // rows land, and a change announced in between would otherwise be
    // overwritten by that older read until the layer next changes.
    const inFlight = useRef(new Set<Map<string, LayerDataCoverage>>())

    const refresh = useCallback(async () => {
        const announced = new Map<string, LayerDataCoverage>()
        inFlight.current.add(announced)
        try {
            const data = await getVisibleLayersWithLegends({
                showOnlyVisible: toolVars.showOnlyVisible === true,
            })
            setLayers(withCoverage(data, announced))
        } catch (err) {
            console.error('LayerManager: refresh failed', err)
            setLayers([])
        } finally {
            inFlight.current.delete(announced)
            setLoading(false)
        }
    }, [toolVars.showOnlyVisible])

    // Core announces a layer's record whenever its verdict or coverage
    // changes, so this keeps each row's warning current between refreshes.
    const applyCoverageChange = useCallback(
        ({ layerName, ...record }: LayerDataCoverageChange) => {
            if (!layerName) return
            for (const announced of inFlight.current) announced.set(layerName, record)
            setLayers((rows) => withCoverage(rows, new Map([[layerName, record]])))
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
    useMMGISEvent('layer:visibilityChange', zoomWhenShown)
    useMMGISEvent('layer:refreshStatusChange', refresh)
    useMMGISEvent('layer:opacityChange', refresh)
    useMMGISEvent('layer:listedChange', refresh)
    useMMGISEvent('layers:listChanged', refresh)

    // 'layers:getAll' is registered by Layers_.fina() during mission load.
    // Wait for it before doing the initial refresh, otherwise the adapter
    // mounts to an empty list and never recovers (no event fires when the
    // mission's layers first become available).
    useMMGISHandlerReady('layers:getAll', refresh)

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
            getDataCoverage={mmgisGetLayerDataCoverage}
            onCompareLayer={compareLayer}
            onAddLayer={showAddLayer}
        />
    )
}
