import React, { act } from 'react'
import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    MMGISThemeRailAdapter,
    withResolvedIcons,
} from '../MMGISThemeRailAdapter'
import { mount, click } from '../../_shared/__tests__/reactHarness'

// The rail's chrome icon is an SVG imported as a React component, which the
// webpack build provides through @svgr and vitest has no equivalent for. The
// chevron is asserted by its button, never by the glyph inside it, so the
// icon module stands in as a component that draws nothing.
vi.mock('../lib/geo/ThemeRail/icons', () => ({
    CollapsePanelIcon: () => null,
}))

/**
 * The chevron drives a panel the rail does not own, so every assertion here is
 * against the bus names core registers. The rail keeps no idea of open/closed
 * of its own: it reads the layout core reports, names the direction it wants,
 * and follows the broadcast back.
 */

const RAIL_PANEL = {
    id: 'rail',
    position: 'left',
    state: 'expanded',
    // The `js` id a mission config gives the tool, which is what the layout
    // lists — not the lowercased name `tool:getVars` is keyed by.
    toolIds: ['LayerFilterThemesTool'],
}
const NEIGHBOUR = {
    id: 'filters',
    position: 'left',
    state: 'expanded',
    toolIds: ['layerfilter'],
}

let request: ReturnType<typeof vi.fn>
let listeners: Record<string, (payload?: unknown) => void>
let panels: unknown[]

// Wrapped in act so the re-render the broadcast causes has flushed by the
// time the spec reads the DOM.
const emit = async (event: string, payload?: unknown) => {
    await act(async () => {
        listeners[event]?.(payload)
    })
}

beforeEach(() => {
    listeners = {}
    panels = [RAIL_PANEL, NEIGHBOUR]
    request = vi.fn(async (name: string) => {
        switch (name) {
            case 'panels:getAll':
                return panels
            case 'tool:getVars':
                return {}
            case 'app:getMissionPath':
                return ''
            default:
                return { ok: true, state: 'expanded', changed: true }
        }
    })
    ;(window as { mmgisAPI?: unknown }).mmgisAPI = {
        request,
        hasHandler: () => true,
        emit: vi.fn(),
        on: (event: string, handler: (payload?: unknown) => void) => {
            listeners[event] = handler
            return () => {
                delete listeners[event]
            }
        },
    }
})

afterEach(() => {
    delete (window as { mmgisAPI?: unknown }).mmgisAPI
    document.body.innerHTML = ''
})

const chevron = (container: HTMLElement) =>
    container.querySelector('.blocks-theme-rail__collapse')

test('the chevron collapses the visible neighbour', async () => {
    const { container, unmount } = await mount(<MMGISThemeRailAdapter />)

    await click(chevron(container) as Element)

    expect(request).toHaveBeenCalledWith('panels:hide', { panelId: 'filters' })
    await unmount()
})

test('the chevron reopens the neighbour once the layout reports it collapsed', async () => {
    const { container, unmount } = await mount(<MMGISThemeRailAdapter />)

    await emit('panels:changed', {
        panels: [RAIL_PANEL, { ...NEIGHBOUR, state: 'collapsed' }],
    })

    expect(chevron(container)?.getAttribute('aria-label')).toBe('Open panel')
    await click(chevron(container) as Element)
    expect(request).toHaveBeenCalledWith('panels:show', { panelId: 'filters' })
    await unmount()
})

test('a region holding several panels leaves the chevron out until one is named', async () => {
    panels = [
        RAIL_PANEL,
        NEIGHBOUR,
        { id: 'legend', position: 'left', state: 'expanded', toolIds: [] },
    ]
    const { container, unmount } = await mount(<MMGISThemeRailAdapter />)

    expect(chevron(container)).toBeNull()

    await unmount()
})

test('the configured panel wins over the neighbour it would have picked', async () => {
    request.mockImplementation(async (name: string) => {
        if (name === 'panels:getAll')
            return [
                RAIL_PANEL,
                NEIGHBOUR,
                { id: 'legend', position: 'left', state: 'expanded', toolIds: [] },
            ]
        if (name === 'tool:getVars') return { togglePanelId: 'legend' }
        if (name === 'app:getMissionPath') return ''
        return { ok: true, state: 'collapsed', changed: true }
    })
    const { container, unmount } = await mount(<MMGISThemeRailAdapter />)

    await click(chevron(container) as Element)

    expect(request).toHaveBeenCalledWith('panels:hide', { panelId: 'legend' })
    await unmount()
})

test('a listing already delivered by the broadcast survives the seed', async () => {
    let resolveSeed: (panels: unknown) => void = () => {}
    request.mockImplementation(async (name: string) => {
        if (name === 'panels:getAll')
            return new Promise((resolve) => {
                resolveSeed = resolve
            })
        if (name === 'tool:getVars') return {}
        if (name === 'app:getMissionPath') return ''
        return { ok: true, state: 'collapsed', changed: true }
    })
    const { container, unmount } = await mount(<MMGISThemeRailAdapter />)

    // The layout moves while the seed request is still in flight, so the seed
    // resolves holding a listing that is already out of date.
    await emit('panels:changed', {
        panels: [RAIL_PANEL, { ...NEIGHBOUR, state: 'collapsed' }],
    })
    await act(async () => {
        resolveSeed([RAIL_PANEL, NEIGHBOUR])
    })

    expect(chevron(container)?.getAttribute('aria-label')).toBe('Open panel')
    await unmount()
})

test('a refused command is reported rather than dropped', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { container, unmount } = await mount(<MMGISThemeRailAdapter />)
    request.mockResolvedValue({ ok: false, reason: 'state-not-allowed' })

    await click(chevron(container) as Element)

    expect(warn).toHaveBeenCalledWith(
        '[LayerFilterThemes] panel "filters" refused: state-not-allowed',
    )
    warn.mockRestore()
    await unmount()
})

// Each icon value the upload field can hold reaches the rail by a different
// route, and only one of the three wants the mission path in front of it.
const iconSrc = (src: string, missionPath: string | null) =>
    withResolvedIcons(
        [{ id: 't', label: 'T', icon: { kind: 'image', src } }],
        missionPath,
    )[0].icon?.src

test('an asset-bucket key stays slash-less', () => {
    // The dashboard page resolves it against its own root, so a leading slash
    // or a mission prefix would point it at a file that is not there.
    expect(
        iconSrc('assets/M/LayerFilterThemes/uploads/x.svg', 'Missions/M/'),
    ).toBe('assets/M/LayerFilterThemes/uploads/x.svg')
})

test('a mission-relative value gains the mission path', () => {
    expect(iconSrc('LayerFilterThemes/uploads/x.svg', 'Missions/M/')).toBe(
        'Missions/M/LayerFilterThemes/uploads/x.svg',
    )
})

test('a linked icon is untouched', () => {
    expect(iconSrc('https://cdn.example.com/x.svg', 'Missions/M/')).toBe(
        'https://cdn.example.com/x.svg',
    )
})
