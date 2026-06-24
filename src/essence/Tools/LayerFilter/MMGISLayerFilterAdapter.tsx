import React, { useState, useEffect, useCallback } from 'react'
import { FilterPanel } from './lib'
import type { LayerFilterConfig, FilterSelections } from './lib/types'
import { useMMGISToolVars, useMMGISEvent } from './adapters/hooks'
import { emitFilterChange } from './adapters/emitFilterChange'

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

    // Recompute + emit matches whenever the theme or its selections change.
    useEffect(() => {
        if (!selectedThemeId) return
        void emitFilterChange(themeProperty, selectedThemeId, selections)
    }, [selectedThemeId, selections, themeProperty])

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
            onChange={handleChange}
        />
    )
}
