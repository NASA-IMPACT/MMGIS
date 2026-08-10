import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { FilterPanel } from './lib'
import type { LayerFilterConfig, FilterSelections } from './lib/types'
import { useMMGISToolVars, useMMGISEvent } from './adapters/hooks'
import { emitFilterChange } from './adapters/emitFilterChange'
import { applyTheme } from './lib/engine'
import { toEngineTheme } from './lib/utils/toEngineTheme'
import { parseCatalog } from './lib/catalog/parseCatalog'
import { buildRows, type LayerInput } from './lib/catalog/buildRows'
import { stacBboxToPolygon } from './lib/utils/geo'
import { buildEntryDisplays } from './lib/utils/entryDisplay'
import type { LayerLike } from './lib/utils/listedUpdates'
import { mmgisRequest } from '../_shared/adapters/mmgisAPI'
import { useMMGISHandlerReady } from '../_shared/adapters/useMMGISHandlerReady'

const SELECTED_THEME_EVENT = 'layerFilter:selectedThemeChanged'
// Stable empty object so effects don't fire every render.
const EMPTY: FilterSelections = {}

export function MMGISLayerFilterAdapter() {
    const vars = useMMGISToolVars<LayerFilterConfig & Record<string, unknown>>(
        'layerfilter',
    )
    const themes = vars.themes ?? []

    const [selectedThemeId, setSelectedThemeId] = useState('')
    const [selectionsByTheme, setSelectionsByTheme] = useState<
        Record<string, FilterSelections>
    >({})
    // Which facet the user touched last (per theme) — the engine treats it as
    // authoritative when selections contradict ("most recent action wins").
    const changedFacetRef = useRef<Record<string, string | undefined>>({})
    // The filter only narrows the layers list after a real user interaction
    // (rail click or filter change) — never on boot, where the default theme
    // is auto-selected and would otherwise hide layers unprompted.
    const [hasInteracted, setHasInteracted] = useState(false)

    const [layerConfigs, setLayerConfigs] = useState<Record<
        string,
        LayerLike
    > | null>(null)

    const loadLayerConfigs = useCallback(() => {
        void mmgisRequest<Record<string, LayerLike>>('layers:getAllConfigs').then(
            (r) => {
                if (r) setLayerConfigs(r)
            },
        )
    }, [])
    // Registers during mission load; wait until it exists so we don't fetch
    // too early and silently get null (then never retry).
    useMMGISHandlerReady('layers:getAllConfigs', loadLayerConfigs)

    const catalog = useMemo(() => parseCatalog(vars.catalog), [vars.catalog])

    // The engine's working set: rows joining layers to catalogue entries.
    // Parse warnings surface once per catalogue/config change.
    const rows = useMemo(() => {
        const layers: LayerInput[] = []
        for (const [uuid, cfg] of Object.entries(layerConfigs ?? {})) {
            if (!cfg || cfg.type === 'header') continue
            const props = cfg.properties ?? {}
            layers.push({
                layerKey: uuid,
                layerProps: props,
                layerGeometry: stacBboxToPolygon(props.bbox) ?? undefined,
            })
        }
        const built = buildRows(layers, catalog)
        for (const warning of [...catalog.warnings, ...built.warnings]) {
            console.warn(`[LayerFilter] ${warning}`)
        }
        return built.rows
    }, [layerConfigs, catalog])

    // Presentation data for the pick-one-entry control (titles, year badges,
    // date ranges, ACTIVE state).
    const entriesById = useMemo(
        () => buildEntryDisplays(catalog.entries),
        [catalog],
    )

    // Pick the default theme once the config loads.
    useEffect(() => {
        if (!selectedThemeId && themes.length) {
            setSelectedThemeId(vars.defaultThemeId || themes[0].id)
        }
    }, [themes, vars.defaultThemeId, selectedThemeId])

    // Follow the rail's selection. The rail only emits on user clicks (its
    // boot-time default selection is set locally, not emitted), so hearing
    // this event counts as interaction.
    const onThemeChanged = useCallback((payload?: unknown) => {
        const id = (payload as { themeId?: string })?.themeId
        if (id) {
            setSelectedThemeId(id)
            setHasInteracted(true)
        }
    }, [])
    useMMGISEvent(SELECTED_THEME_EVENT, onThemeChanged)

    const activeTheme = themes.find((t) => t.id === selectedThemeId) || null
    const selections = selectionsByTheme[selectedThemeId] || EMPTY

    // Run the engine: options+counts per facet, surviving layers, and
    // selections after invalidation (stale values auto-clear).
    const result = useMemo(() => {
        if (!activeTheme) return null
        return applyTheme(rows, toEngineTheme(activeTheme), selections, {
            changedFacetId: changedFacetRef.current[activeTheme.id],
        })
    }, [activeTheme, rows, selections])

    // Write engine-cleared selections back so the UI reflects them.
    useEffect(() => {
        if (!result || !selectedThemeId) return
        const cleaned = result.selections as FilterSelections
        if (JSON.stringify(cleaned) !== JSON.stringify(selections)) {
            setSelectionsByTheme((prev) => ({
                ...prev,
                [selectedThemeId]: cleaned,
            }))
        }
    }, [result, selections, selectedThemeId])

    // Announce + apply whenever the outcome changes.
    useEffect(() => {
        if (!selectedThemeId || !result) return
        emitFilterChange(
            selectedThemeId,
            selections,
            result.layerKeys,
            layerConfigs,
            hasInteracted,
        )
    }, [selectedThemeId, result, selections, layerConfigs, hasInteracted])

    const handleChange = useCallback(
        (filterId: string, value: FilterSelections[string]) => {
            setHasInteracted(true)
            changedFacetRef.current[selectedThemeId] = filterId
            setSelectionsByTheme((prev) => ({
                ...prev,
                [selectedThemeId]: {
                    ...(prev[selectedThemeId] || {}),
                    [filterId]: value,
                },
            }))
        },
        [selectedThemeId],
    )

    return (
        <FilterPanel
            theme={activeTheme}
            selections={selections}
            optionsByFilter={result?.options}
            entriesById={entriesById}
            geocoderUrl={vars.geocoder?.url || undefined}
            onChange={handleChange}
        />
    )
}
