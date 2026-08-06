import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { FilterPanel } from './lib'
import type {
    LayerFilterConfig,
    FilterSelections,
    FilterOption,
} from './lib/types'
import { useMMGISToolVars } from '../_shared/adapters/useMMGISToolVars'
import { useMMGISEvent } from '../_shared/adapters/useMMGISEvent'
import { emitFilterChange } from './adapters/emitFilterChange'
import { resolveOptions, type TimeConfigLike } from './lib/utils/resolveOptions'
import {
    normalizeThemesConfig,
    resolveDefaultThemeId,
} from './lib/normalizeConfig'
import type { LayerLike } from './lib/utils/matchLayers'
import { mmgisRequest } from '../_shared/adapters/mmgisAPI'
import { useMMGISHandlerReady } from '../_shared/adapters/useMMGISHandlerReady'

const SELECTED_THEME_EVENT = 'layerFilter:selectedThemeChanged'
// Stable empty object so the emit effect doesn't fire every render.
const EMPTY: FilterSelections = {}

export function MMGISLayerFilterAdapter() {
    const vars = useMMGISToolVars<LayerFilterConfig & Record<string, unknown>>(
        'layerfilter',
    )
    // Hand-authored JSON: normalize (with loud warnings) before anything
    // indexes into it — a config typo must never unmount the panel.
    const themes = useMemo(() => normalizeThemesConfig(vars.themes), [vars.themes])
    const themeProperty = vars.themeProperty || 'theme'

    const [selectedThemeId, setSelectedThemeId] = useState('')
    const [selectionsByTheme, setSelectionsByTheme] = useState<
        Record<string, FilterSelections>
    >({})
    // The filter only narrows the layers list after a real user interaction
    // (rail click or filter change) — never on boot, where the default theme
    // is auto-selected and would otherwise hide layers unprompted.
    const [hasInteracted, setHasInteracted] = useState(false)

    // Data the filter derives from: layer configs (matching + data-driven
    // options) and the mission's configured time range (year options).
    const [layerConfigs, setLayerConfigs] = useState<Record<
        string,
        LayerLike
    > | null>(null)
    const [timeConfig, setTimeConfig] = useState<TimeConfigLike | null>(null)

    const loadLayerConfigs = useCallback(() => {
        void mmgisRequest<Record<string, LayerLike>>('layers:getAllConfigs').then(
            (r) => {
                if (r) setLayerConfigs(r)
            },
        )
    }, [])
    const loadTimeConfig = useCallback(() => {
        void mmgisRequest<TimeConfigLike>('time:getConfig').then((r) => {
            if (r) setTimeConfig(r)
        })
    }, [])
    // These handlers register during mission load; wait until they exist so we
    // don't fetch too early and silently get null (then never retry).
    useMMGISHandlerReady('layers:getAllConfigs', loadLayerConfigs)
    useMMGISHandlerReady('time:getConfig', loadTimeConfig)

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

    // Resolve each filter's options (config override → time → data).
    const optionsByFilter = useMemo(() => {
        const map: Record<string, FilterOption[]> = {}
        if (activeTheme) {
            for (const f of activeTheme.filters) {
                map[f.id] = resolveOptions(f, layerConfigs, timeConfig)
            }
        }
        return map
    }, [activeTheme, layerConfigs, timeConfig])

    // Recompute + emit matches whenever the theme, its selections, or the
    // loaded layer configs change; apply to the layers list only after the
    // user has engaged the filter.
    useEffect(() => {
        if (!selectedThemeId) return
        // Don't announce until layer configs exist: an early emit carries an
        // empty match set and any listening consumer would blank the layer
        // list at boot.
        if (!layerConfigs) return
        emitFilterChange(
            themeProperty,
            selectedThemeId,
            selections,
            layerConfigs,
            hasInteracted,
        )
    }, [selectedThemeId, selections, themeProperty, layerConfigs, hasInteracted])

    const handleChange = useCallback(
        (property: string, value: string) => {
            setHasInteracted(true)
            setSelectionsByTheme((prev) => ({
                ...prev,
                [selectedThemeId]: {
                    ...(prev[selectedThemeId] || {}),
                    [property]: value,
                },
            }))
        },
        [selectedThemeId],
    )

    return (
        <FilterPanel
            theme={activeTheme}
            selections={selections}
            optionsByFilter={optionsByFilter}
            onChange={handleChange}
        />
    )
}
