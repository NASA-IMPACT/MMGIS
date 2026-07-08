import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { FilterPanel } from './lib'
import type {
    LayerFilterConfig,
    FilterSelections,
    FilterOption,
} from './lib/types'
import { useMMGISToolVars, useMMGISEvent } from './adapters/hooks'
import { emitFilterChange } from './adapters/emitFilterChange'
import { resolveOptions, type TimeConfigLike } from './lib/utils/resolveOptions'
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
    const themes = vars.themes ?? []
    const themeProperty = vars.themeProperty || 'theme'

    const [selectedThemeId, setSelectedThemeId] = useState('')
    const [selectionsByTheme, setSelectionsByTheme] = useState<
        Record<string, FilterSelections>
    >({})

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

    // Pick the default theme once the config loads.
    useEffect(() => {
        if (!selectedThemeId && themes.length) {
            setSelectedThemeId(vars.defaultThemeId || themes[0].id)
        }
    }, [themes, vars.defaultThemeId, selectedThemeId])

    // Follow the rail's selection.
    const onThemeChanged = useCallback((payload?: unknown) => {
        const id = (payload as { themeId?: string })?.themeId
        if (id) setSelectedThemeId(id)
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
    // loaded layer configs change.
    useEffect(() => {
        if (!selectedThemeId) return
        emitFilterChange(themeProperty, selectedThemeId, selections, layerConfigs)
    }, [selectedThemeId, selections, themeProperty, layerConfigs])

    const handleChange = useCallback(
        (property: string, value: string) => {
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
