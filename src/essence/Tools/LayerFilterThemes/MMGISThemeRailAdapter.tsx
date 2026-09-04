import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { ThemeRail } from './lib'
import { normalizeRailThemes, resolveInitialThemeId } from './lib/normalizeThemes'
import { useMMGISToolVars } from '../_shared/adapters/useMMGISToolVars'
import { useMMGISHandlerReady } from '../_shared/adapters/useMMGISHandlerReady'
import {
    mmgisEmit,
    mmgisGetMissionPath,
    mmgisGetPanels,
    mmgisHidePanel,
    mmgisOnPanelsChanged,
    mmgisShowPanel,
    type PanelInfo,
} from '../_shared/adapters/mmgisAPI'
import { resolveMissionAssetUrl } from '../../../pre/uploadKey'
import type { ThemeSummary } from './lib/types'

// This plugin's own broadcast — named after the rail, not the panel, so a
// replacement panel can subscribe without inheriting the old panel's name.
const SELECTED_THEME_EVENT = 'plugin:layerfilterthemes:selectedThemeChanged'

// How the layout identifies this plugin — the `js` id a mission config gives
// the tool, which is what a panel lists in `toolIds`. Distinct from the
// lowercased tool name `tool:getVars` is keyed by.
const TOOL_ID = 'LayerFilterThemesTool'

type ThemeRailVars = {
    themes?: unknown
    defaultThemeId?: unknown
    togglePanelId?: unknown
}

/**
 * The panel the rail's chevron opens and closes: the configured one, else the
 * rail's own neighbour — the one other panel sharing its region. Null when
 * nothing resolves, which leaves the chevron out rather than drawing a control
 * with nothing behind it.
 */
function resolveTogglePanel(
    panels: PanelInfo[],
    configured: unknown,
): PanelInfo | null {
    if (panels.length === 0) return null

    if (typeof configured === 'string' && configured !== '') {
        return panels.find((panel) => panel.id === configured) ?? null
    }

    const own = panels.find((panel) => panel.toolIds.includes(TOOL_ID))
    if (!own) return null
    // Only an unambiguous neighbour is safe to pick blind; a region holding
    // several panels needs `togglePanelId` to say which.
    const neighbours = panels.filter(
        (panel) => panel.id !== own.id && panel.position === own.position,
    )
    return neighbours.length === 1 ? neighbours[0] : null
}

/**
 * Points an uploaded icon at the file the mission actually serves. The upload
 * field stores either a mission-relative path
 * ("LayerFilterThemes/uploads/<uuid>.svg") or a lean-mode upload key
 * ("assets/<mission>/LayerFilterThemes/uploads/<uuid>.svg"); a link the author
 * pasted is already complete and passes through. src/pre/uploadKey.ts knows
 * every shape, so the rail resolves through it rather than testing its own.
 */
export function withResolvedIcons(
    themes: ThemeSummary[],
    missionPath: string | null,
): ThemeSummary[] {
    return themes.map((theme) => {
        if (theme.icon?.kind !== 'image') return theme
        return {
            ...theme,
            icon: {
                kind: 'image',
                src: resolveMissionAssetUrl(theme.icon.src, missionPath),
            },
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
    // idea of open/closed: core's listing is the only source, and the chevron
    // stays right even when the panel is closed from somewhere else.
    const [panels, setPanels] = useState<PanelInfo[]>([])
    // A drag-resize broadcasts a layout change per frame, none of which move
    // anything the rail draws — keep the old array unless what the rail reads
    // actually differs, so those frames cost no re-render.
    const applyPanels = useCallback((all: PanelInfo[]) => {
        setPanels((current) =>
            JSON.stringify(current) === JSON.stringify(all) ? current : all,
        )
    }, [])
    // Set once the broadcast has delivered a listing, which is fresher than
    // anything the seed below can be holding.
    const followingRef = useRef(false)
    useEffect(
        () =>
            mmgisOnPanelsChanged((all) => {
                followingRef.current = true
                applyPanels(all)
            }),
        [applyPanels],
    )
    // Seed the first listing: the subscription only carries changes, so a rail
    // that mounts into a settled layout would otherwise draw nothing until
    // something moved. The panel providers register at module load, so there is
    // no handler to wait for — but the request can still resolve after a
    // broadcast has landed, so it yields to one that has.
    useEffect(() => {
        void mmgisGetPanels().then((all) => {
            if (!followingRef.current) applyPanels(all)
        })
    }, [applyPanels])

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
    // Collapsed panels open, visible ones close. Naming the direction rather
    // than asking core to toggle keeps the chevron and the panel in step: the
    // command matches the state the rail is drawing. A panel whose constraints
    // forbid collapsing refuses, which is worth saying out loud — the rail
    // cannot tell from the listing which panels those are.
    const onToggleCollapse = useCallback(() => {
        if (!togglePanel) return
        const command =
            togglePanel.state === 'collapsed' ? mmgisShowPanel : mmgisHidePanel
        void command(togglePanel.id).then((result) => {
            // Compared against the discriminant so the branch narrows to the
            // arm carrying a reason.
            if (result.ok === false)
                console.warn(
                    `[LayerFilterThemes] panel "${togglePanel.id}" refused: ${result.reason}`,
                )
        })
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
