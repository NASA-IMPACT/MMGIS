import React, { useState, useEffect, useCallback } from 'react'
import { ThemeRail } from './lib'
import type { ThemeSummary } from './lib/types'
import { getThemes } from './adapters/getThemes'
import { useMMGISEvent } from '../_shared/adapters/useMMGISEvent'
import { mmgisEmit } from '../_shared/adapters/mmgisAPI'

// This plugin's own broadcast — named after the rail, not the panel, so a
// replacement panel can subscribe without inheriting the old panel's name.
const SELECTED_THEME_EVENT = 'plugin:layerfilterthemes:selectedThemeChanged'

export function MMGISThemeRailAdapter() {
    const [themes, setThemes] = useState<ThemeSummary[]>([])
    const [selectedId, setSelectedId] = useState('')

    const load = useCallback(async () => {
        const { themes: loaded, defaultThemeId } = await getThemes()
        setThemes(loaded)
        setSelectedId((cur) => cur || defaultThemeId || (loaded[0]?.id ?? ''))
    }, [])

    useEffect(() => {
        void load()
    }, [load])

    // The LayerFilter (panel) tool provides the themes; if the rail mounts
    // first, re-pull once the panel announces it's ready. Stable handler —
    // an inline arrow would resubscribe every render.
    const onPanelReady = useCallback(() => {
        void load()
    }, [load])
    useMMGISEvent('plugin:layerfilter:ready', onPanelReady)

    const onSelect = useCallback((id: string) => {
        setSelectedId(id)
        mmgisEmit(SELECTED_THEME_EVENT, { themeId: id })
    }, [])

    return <ThemeRail themes={themes} selectedId={selectedId} onSelect={onSelect} />
}
