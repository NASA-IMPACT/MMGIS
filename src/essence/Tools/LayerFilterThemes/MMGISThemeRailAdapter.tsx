import React, { useState, useEffect, useCallback } from 'react'
import { ThemeRail } from './lib'
import type { ThemeSummary } from './lib/types'
import { getThemes } from './adapters/getThemes'
import { useMMGISEvent } from './adapters/hooks'
import { mmgisEmit } from '../_shared/adapters/mmgisAPI'

const SELECTED_THEME_EVENT = 'layerFilter:selectedThemeChanged'
const PANEL_CLOSE_EVENT = 'layerFilter:panelCloseClicked'

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
    // first, re-pull once the panel announces it's ready.
    useMMGISEvent('layerFilter:ready', () => {
        void load()
    })

    const onSelect = useCallback((id: string) => {
        setSelectedId(id)
        mmgisEmit(SELECTED_THEME_EVENT, { themeId: id })
    }, [])

    return (
        <ThemeRail
            themes={themes}
            selectedId={selectedId}
            onSelect={onSelect}
            onTopButtonClick={() => {
                console.log('[LayerFilterThemes] emit', PANEL_CLOSE_EVENT)
                mmgisEmit(PANEL_CLOSE_EVENT)
            }}
        />
    )
}
