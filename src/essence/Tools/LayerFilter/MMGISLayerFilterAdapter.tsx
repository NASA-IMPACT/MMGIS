import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { FilterPanel } from './lib'
import type {
    LayerFilterConfig,
    FilterSelections,
    GeocodeSelection,
} from './lib/types'
import { useMMGISToolVars } from '../_shared/adapters/useMMGISToolVars'
import { useMMGISEvent } from '../_shared/adapters/useMMGISEvent'
import { emitFilterChange } from './adapters/emitFilterChange'
import { applyTheme } from './lib/engine'
import { toEngineTheme } from './lib/utils/toEngineTheme'
import { parseCatalog } from './lib/catalog/parseCatalog'
import { buildRows, type LayerInput } from './lib/catalog/buildRows'
import { stacBboxToPolygon } from './lib/utils/geo'
import { buildEntryDisplays } from './lib/utils/entryDisplay'
import {
    normalizeThemesConfig,
    resolveDefaultThemeId,
} from './lib/normalizeConfig'
import type { LayerLike } from './lib/utils/listedUpdates'
import { mmgisRequest } from '../_shared/adapters/mmgisAPI'
import { useMMGISHandlerReady } from '../_shared/adapters/useMMGISHandlerReady'

// Emitted by the rail plugin, so named after the rail — swap the panel out
// and the rail's broadcasts keep their owner's name.
const SELECTED_THEME_EVENT = 'plugin:layerfilterthemes:selectedThemeChanged'
// Stable empty object so effects don't fire every render.
const EMPTY: FilterSelections = {}

export function MMGISLayerFilterAdapter() {
    const vars = useMMGISToolVars<LayerFilterConfig & Record<string, unknown>>(
        'layerfilter',
    )
    // Hand-authored JSON: normalize (with loud warnings) before anything
    // indexes into it — a config typo must never unmount the panel.
    const themes = useMemo(() => normalizeThemesConfig(vars.themes), [vars.themes])

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
    // too early and silently get null (then never retry). Generous timeout:
    // it registers only after ALL mission layers finish loading — a slow
    // mission blowing the default 10 s would leave the filter permanently
    // data-less.
    useMMGISHandlerReady('layers:getAllConfigs', loadLayerConfigs, {
        timeoutMs: 60000,
    })

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

    // Pick the default theme once the config loads. A defaultThemeId that
    // matches no theme falls back to the first theme (with a warning) —
    // selecting it verbatim would leave activeTheme null and the panel blank.
    useEffect(() => {
        if (!selectedThemeId && themes.length) {
            const id = resolveDefaultThemeId(themes, vars.defaultThemeId)
            if (id) setSelectedThemeId(id)
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
        // Don't announce until layer configs exist: an early emit carries an
        // empty match set and any listening consumer would blank the layer
        // list at boot.
        if (!layerConfigs) return
        emitFilterChange(
            selectedThemeId,
            selections,
            result.layerKeys,
            layerConfigs,
            hasInteracted,
        )
    }, [selectedThemeId, result, selections, layerConfigs, hasInteracted])

    const handleChange = useCallback(
        (filterId: string, value: string | string[] | GeocodeSelection | null) => {
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
