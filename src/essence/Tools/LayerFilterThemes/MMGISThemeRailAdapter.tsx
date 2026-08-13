import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { ThemeRail } from './lib'
import { normalizeRailThemes, resolveInitialThemeId } from './lib/normalizeThemes'
import { useMMGISToolVars } from '../_shared/adapters/useMMGISToolVars'
import { useMMGISEvent } from '../_shared/adapters/useMMGISEvent'
import { useMMGISHandlerReady } from '../_shared/adapters/useMMGISHandlerReady'
import {
    mmgisEmit,
    mmgisGetMissionPath,
    mmgisGetPanels,
    mmgisTogglePanelCollapsed,
    PANEL_LAYOUT_CHANGED_EVENT,
    type PanelSummary,
} from '../_shared/adapters/mmgisAPI'
import type { ThemeSummary } from './lib/types'

// This plugin's own broadcast — named after the rail, not the panel, so a
// replacement panel can subscribe without inheriting the old panel's name.
const SELECTED_THEME_EVENT = 'plugin:layerfilterthemes:selectedThemeChanged'

// How this plugin is identified in the layout, which is how the rail finds the
// panel it lives in — and from there its neighbour.
const TOOL_ID = 'layerfilterthemes'

type ThemeRailVars = {
    themes?: unknown
    defaultThemeId?: unknown
    togglePanelId?: unknown
}

/**
 * The panel the rail's chevron opens and closes: the configured one, else the
 * rail's own neighbour — the one other collapsible panel sharing its region.
 * Null when nothing resolves, which leaves the chevron out rather than drawing
 * a control with nothing behind it.
 */
function resolveTogglePanel(
    panels: PanelSummary[],
    configured: unknown,
): PanelSummary | null {
    if (panels.length === 0) return null

    if (typeof configured === 'string' && configured !== '') {
        return panels.find((panel) => panel.id === configured) ?? null
    }

    const own = panels.find((panel) => panel.toolIds.includes(TOOL_ID))
    if (!own) return null
    // Only an unambiguous neighbour is safe to pick blind; a region holding
    // several collapsible panels needs `togglePanelId` to say which.
    const neighbours = panels.filter(
        (panel) =>
            panel.id !== own.id &&
            panel.position === own.position &&
            panel.collapsible,
    )
    return neighbours.length === 1 ? neighbours[0] : null
}

/**
 * Points an uploaded icon at the file the mission actually serves. The upload
 * field stores a path relative to the mission directory
 * ("LayerFilterThemes/uploads/<uuid>.svg"); a link the author pasted is already
 * complete and passes through.
 */
function withResolvedIcons(
    themes: ThemeSummary[],
    missionPath: string | null,
): ThemeSummary[] {
    return themes.map((theme) => {
        if (theme.icon?.kind !== 'image') return theme
        if (/^(https?:|data:|\/)/i.test(theme.icon.src)) return theme
        return {
            ...theme,
            icon: { kind: 'image', src: (missionPath || '') + theme.icon.src },
        }
    })
}

export function MMGISThemeRailAdapter() {
    // The rail owns what it renders (id/label/icon) and which theme is
    // selected. The panel owns each theme's filters; the two join on `id`.
    const vars = useMMGISToolVars<ThemeRailVars>('layerfilterthemes')

    // Uploaded icons are stored mission-relative, so the rail needs the
    // mission's path before it can draw them.
    const [missionPath, setMissionPath] = useState<string | null>(null)
    const refreshMissionPath = useCallback(async () => {
        setMissionPath(await mmgisGetMissionPath())
    }, [])
    useMMGISHandlerReady('app:getMissionPath', refreshMissionPath)

    // Hand-authored config: normalize (with loud warnings) before rendering —
    // a config typo must never unmount the rail.
    const themes = useMemo(
        () => withResolvedIcons(normalizeRailThemes(vars.themes), missionPath),
        [vars.themes, missionPath],
    )

    const [selectedId, setSelectedId] = useState('')
    // The boot announcement must fire exactly once, even though `themes`
    // re-resolves whenever vars refresh.
    const announcedRef = useRef(false)

    // Announce the boot-time default so the panel knows which theme to show.
    // Tagged `initial` so the panel selects it without counting it as user
    // interaction — otherwise boot would narrow the layers list unprompted.
    useEffect(() => {
        if (announcedRef.current || themes.length === 0) return
        const id = resolveInitialThemeId(themes, vars.defaultThemeId)
        if (!id) return
        announcedRef.current = true
        setSelectedId(id)
        mmgisEmit(SELECTED_THEME_EVENT, { themeId: id, initial: true })
    }, [themes, vars.defaultThemeId])

    const onSelect = useCallback((id: string) => {
        setSelectedId(id)
        mmgisEmit(SELECTED_THEME_EVENT, { themeId: id })
    }, [])

    // The layout is core's, so the rail reads it rather than tracking its own
    // idea of open/closed: re-pull on every layout change and the chevron stays
    // right even when the panel is closed from somewhere else.
    const [panels, setPanels] = useState<PanelSummary[]>([])
    const refreshPanels = useCallback(async () => {
        const all = await mmgisGetPanels()
        if (!all) return
        // A drag-resize broadcasts a layout change per frame, none of which
        // move anything the rail draws — keep the old array unless what the
        // rail reads actually differs, so those frames cost no re-render.
        setPanels((current) =>
            JSON.stringify(current) === JSON.stringify(all) ? current : all,
        )
    }, [])
    useMMGISHandlerReady('panels:getAll', refreshPanels)
    useMMGISEvent(PANEL_LAYOUT_CHANGED_EVENT, refreshPanels)

    const togglePanel = useMemo(
        () => resolveTogglePanel(panels, vars.togglePanelId),
        [panels, vars.togglePanelId],
    )

    // Same posture as the themes config: a panel id that matches nothing is an
    // admin typo worth saying out loud, but only once per configured value —
    // the resolution above re-runs on every layout change.
    const configuredToggleId = vars.togglePanelId
    useEffect(() => {
        if (panels.length === 0) return
        if (typeof configuredToggleId !== 'string' || configuredToggleId === '')
            return
        if (!panels.some((panel) => panel.id === configuredToggleId))
            console.warn(
                `[LayerFilterThemes] config error: togglePanelId "${configuredToggleId}" matches no panel — the collapse control is hidden`,
            )
    }, [panels, configuredToggleId])
    const onToggleCollapse = useCallback(() => {
        if (togglePanel) void mmgisTogglePanelCollapsed(togglePanel.id)
    }, [togglePanel])

    return (
        <ThemeRail
            themes={themes}
            selectedId={selectedId}
            onSelect={onSelect}
            onToggleCollapse={togglePanel ? onToggleCollapse : undefined}
            collapsed={togglePanel?.state === 'collapsed'}
        />
    )
}
