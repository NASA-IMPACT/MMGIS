import React from 'react'
import { useCallback, useState } from 'react'
import { Title } from './lib'
import { mmgisRequest } from '../_shared/adapters/mmgisAPI'
import { useMMGISHandlerReady } from '../_shared/adapters/useMMGISHandlerReady'
import { resolveAction } from '../_shared/actions/resolveAction'

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
 * title fallback order lives here, not in the core provider), and hands the
 * action button's configured link off to resolveAction.
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
        resolveAction(state.actionButtonLink)
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
