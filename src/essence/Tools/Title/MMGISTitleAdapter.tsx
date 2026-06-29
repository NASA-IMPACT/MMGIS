import React from 'react'
import { useCallback, useState } from 'react'
import { Title } from './lib'
import { mmgisRequest, mmgisEmit } from '../_shared/adapters/mmgisAPI'
import { useMMGISHandlerReady } from '../_shared/adapters/useMMGISHandlerReady'

const PLUGIN_ID = 'title'
const DEFAULT_TITLE = 'MMGIS'
const DEFAULT_ICON = 'mdi mdi-earth mdi-24px'

/** Raw mission branding from the 'app:getBranding' bus provider. */
type Branding = {
    pagename?: string | null
    mission?: string | null
    name?: string | null
    logoUrl?: string | null
}

/** Title tool variables from 'tool:getVars'. */
type TitleToolVars = {
    icon?: string
    showLogo?: boolean
    showTitleText?: boolean
    actionButtonText?: string
    actionButtonLink?: string
}

type TitleState = {
    titleText: string
    logoUrl: string | null
    iconClass: string
    showLogo: boolean
    showTitleText: boolean
    actionButtonText: string
    actionButtonLink: string
}

const INITIAL_STATE: TitleState = {
    titleText: DEFAULT_TITLE,
    logoUrl: null,
    iconClass: DEFAULT_ICON,
    showLogo: true,
    showTitleText: true,
    actionButtonText: '',
    actionButtonLink: '',
}

/**
 * Bridges MMGIS state to the portable <Title> component. Reads mission branding
 * and tool variables over the mmgisAPI bus, resolves the display props (the
 * title fallback order lives here, not in the core provider), and owns the
 * action-button effect (open a URL, or emit a namespaced bus event).
 */
export function MMGISTitleAdapter() {
    const [state, setState] = useState<TitleState>(INITIAL_STATE)

    const refresh = useCallback(async () => {
        try {
            const [branding, vars] = await Promise.all([
                mmgisRequest<Branding>('app:getBranding'),
                mmgisRequest<TitleToolVars>('tool:getVars', PLUGIN_ID),
            ])
            const b = branding || {}
            const v = vars || {}
            setState({
                titleText:
                    b.pagename || b.mission || b.name || DEFAULT_TITLE,
                logoUrl: b.logoUrl || null,
                iconClass: v.icon || DEFAULT_ICON,
                showLogo: v.showLogo !== false,
                showTitleText: v.showTitleText !== false,
                actionButtonText: v.actionButtonText || '',
                actionButtonLink: v.actionButtonLink || '',
            })
        } catch (err) {
            console.error('Title: refresh failed', err)
        }
    }, [])

    // 'tool:getVars' / 'app:getBranding' are registered together by
    // Layers_.fina() during mission load. Wait for readiness before the first
    // fetch, otherwise the adapter mounts to defaults and never recovers.
    useMMGISHandlerReady('tool:getVars', refresh)

    const handleActionClick = useCallback(() => {
        const link = state.actionButtonLink
        if (!link) return
        if (link.startsWith('http://') || link.startsWith('https://')) {
            window.open(link, '_blank', 'noopener,noreferrer')
            return
        }
        // Core commands using the "core:action:target" syntax (e.g. "core:showPlugin:LayersTool")
        if (link.startsWith('core:')) {
            const parts = link.substring(5).split(':')
            const action = parts[0]
            const target = parts.slice(1).join(':')
            
            // Dispatch with the target mapped to both possible expected arguments
            // so the core dispatcher (mmgisAPI._initCoreCommandDispatcher) can consume what it needs.
            mmgisEmit('core:command', { action, pluginId: target, panelId: target, targetId: target })
            return
        }

        // Custom namespaced events (e.g. "LayerManager:someEvent")
        if (link.indexOf(':') !== -1) {
            mmgisEmit(link)
            return
        }

        // Fallback: simple event under this plugin's namespace (no colons)
        mmgisEmit(`plugin:${PLUGIN_ID}:${link}`)
    }, [state.actionButtonLink])

    return (
        <Title
            titleText={state.titleText}
            logoUrl={state.logoUrl}
            iconClass={state.iconClass}
            showLogo={state.showLogo}
            showTitleText={state.showTitleText}
            showAction={!!state.actionButtonLink}
            actionLabel={state.actionButtonText}
            actionTitle={state.actionButtonLink}
            onActionClick={handleActionClick}
        />
    )
}
