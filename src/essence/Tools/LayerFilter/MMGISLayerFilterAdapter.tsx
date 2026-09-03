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
import { normalizeThemesConfig } from './lib/normalizeConfig'
import { interpretThemeSelection } from './lib/utils/themeSelection'
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

    // The rail owns theme selection and announces its boot-time default, so
    // normally it names the theme before this fires. Fall back to the first
    // configured theme anyway, so the panel still works when it's placed
    // without a rail (otherwise it would render blank forever).
    //
    // The fallback only shows through if the rail's announcement lands before
    // this component subscribes — it shouldn't, since we subscribe at mount
    // while the rail waits on 'tool:getVars' (registered after mission load).
    // If that ordering ever breaks, the visible symptom is the panel showing
    // its first theme while the rail highlights another, self-healing on the
    // first click; the fix would be a 'getSelected' provider on the rail.
    useEffect(() => {
        if (!selectedThemeId && themes.length) setSelectedThemeId(themes[0].id)
    }, [themes, selectedThemeId])

    // Follow the rail's selection. Its boot announcement carries
    // `initial: true` and must NOT count as interaction — otherwise boot
    // would narrow the layers list unprompted.
    const onThemeChanged = useCallback((payload?: unknown) => {
        const selection = interpretThemeSelection(payload)
        if (!selection) return
        setSelectedThemeId(selection.themeId)
        if (selection.isInteraction) setHasInteracted(true)
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
