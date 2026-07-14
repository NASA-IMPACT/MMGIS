import React, { useState, useEffect, useCallback } from 'react'
import { ThemeRail } from './lib'
import type { ThemeSummary } from './lib/types'
import { getThemes } from './adapters/getThemes'
import { useMMGISEvent } from './adapters/hooks'
import { mmgisEmit, mmgisRequest } from '../_shared/adapters/mmgisAPI'
import { useMMGISHandlerReady } from '../_shared/adapters/useMMGISHandlerReady'

const PLUGIN_ID = 'LayerFilterThemes'
// 'tool:getVars' matches tools by `tool.name.toLowerCase()`, so the lookup key
// must be lowercase — passing the PascalCase PLUGIN_ID never matches, which
// silently drops the admin-configured vars and falls back to the default panel.
const TOOL_VARS_KEY = PLUGIN_ID.toLowerCase()
const SELECTED_THEME_EVENT = 'layerFilter:selectedThemeChanged'
// The panel next to the rail lives in this region by default. Configurable via
// the tool's `togglePanelId` variable.
const DEFAULT_TOGGLE_PANEL_ID = 'left-panel'

/** LayerFilterThemes tool variables from 'tool:getVars'. */
type ThemeRailVars = {
    togglePanelId?: string
}

export function MMGISThemeRailAdapter() {
    const [themes, setThemes] = useState<ThemeSummary[]>([])
    const [selectedId, setSelectedId] = useState('')
    // The panel next to the rail starts visible, so the chevron starts pointing
    // left. Each click flips this (rotating the chevron to point right) and
    // toggles the panel directly through core's `core:togglePanel` command.
    const [collapsed, setCollapsed] = useState(false)
    const [togglePanelId, setTogglePanelId] = useState(DEFAULT_TOGGLE_PANEL_ID)

    const load = useCallback(async () => {
        const { themes: loaded, defaultThemeId } = await getThemes()
        setThemes(loaded)
        setSelectedId((cur) => cur || defaultThemeId || (loaded[0]?.id ?? ''))
    }, [])

    useEffect(() => {
        void load()
    }, [load])

    // Resolve the panel to toggle from the tool's config vars, falling back to
    // the default left panel. 'tool:getVars' is registered during mission load,
    // so wait for readiness before the first fetch.
    const loadVars = useCallback(async () => {
        try {
            const vars = await mmgisRequest<ThemeRailVars>('tool:getVars', TOOL_VARS_KEY)
            setTogglePanelId(vars?.togglePanelId || DEFAULT_TOGGLE_PANEL_ID)
        } catch (err) {
            console.error('[LayerFilterThemes] failed to read tool vars', err)
        }
    }, [])
    useMMGISHandlerReady('tool:getVars', loadVars)

    // The LayerFilter (panel) tool provides the themes; if the rail mounts
    // first, re-pull once the panel announces it's ready.
    useMMGISEvent('layerFilter:ready', () => {
        void load()
    })

    const onSelect = useCallback((id: string) => {
        setSelectedId(id)
        mmgisEmit(SELECTED_THEME_EVENT, { themeId: id })
    }, [])

    const onToggle = useCallback(() => {
        mmgisEmit('core:togglePanel', { panelId: togglePanelId })
        setCollapsed((prev) => !prev)
    }, [togglePanelId])

    return (
        <ThemeRail
            themes={themes}
            selectedId={selectedId}
            onSelect={onSelect}
            collapsed={collapsed}
            onTopButtonClick={onToggle}
        />
    )
}
