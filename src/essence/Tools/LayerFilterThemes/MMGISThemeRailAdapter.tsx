import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { ThemeRail } from './lib'
import { normalizeRailThemes, resolveInitialThemeId } from './lib/normalizeThemes'
import { useMMGISToolVars } from '../_shared/adapters/useMMGISToolVars'
import { mmgisEmit } from '../_shared/adapters/mmgisAPI'

// This plugin's own broadcast — named after the rail, not the panel, so a
// replacement panel can subscribe without inheriting the old panel's name.
const SELECTED_THEME_EVENT = 'plugin:layerfilterthemes:selectedThemeChanged'

type ThemeRailVars = {
    themes?: unknown
    defaultThemeId?: unknown
}

export function MMGISThemeRailAdapter() {
    // The rail owns what it renders (id/label/icon) and which theme is
    // selected. The panel owns each theme's filters; the two join on `id`.
    const vars = useMMGISToolVars<ThemeRailVars>('layerfilterthemes')
    // Hand-authored JSON: normalize (with loud warnings) before rendering —
    // a config typo must never unmount the rail.
    const themes = useMemo(() => normalizeRailThemes(vars.themes), [vars.themes])

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

    return <ThemeRail themes={themes} selectedId={selectedId} onSelect={onSelect} />
}
