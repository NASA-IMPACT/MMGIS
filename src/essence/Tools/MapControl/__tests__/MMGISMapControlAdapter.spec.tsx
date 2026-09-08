import React from 'react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { MMGISMapControlAdapter } from '../MMGISMapControlAdapter'
import { mount, click } from '../../_shared/__tests__/reactHarness'

// The share trigger's glyph is an SVG the webpack build routes through @svgr,
// which exports it as `ReactComponent`; vitest treats the file as a plain
// asset, so that export is missing. Nothing here asserts on the glyph, so the
// module stands in as a component that draws nothing.
vi.mock('../../_shared/share/share-map.svg', () => ({
    ReactComponent: () => null,
}))

/**
 * The adapter's only input is `tool:getVars`, which hands back the mission
 * JSON's `variables` object verbatim — any field may be any JSON type. So the
 * cases here feed the bus the shapes a config author can actually produce and
 * assert on what the bar renders. The action button is the field that has to
 * survive that: MapControlTool mounts this adapter with no error boundary, so
 * a value the adapter treats as text without checking takes the whole bar down
 * — search, basemaps, measure, zoom and share included.
 *
 * Clicking is asserted through `window.open`, the seam an `https://` action
 * ends at. The other action forms belong to resolveAction and are covered in
 * its own spec.
 */

const LINK = 'https://example.com/analysis'

let request: ReturnType<typeof vi.fn>

/** Answer the bus with one mission's tool variables. */
const withVars = (vars: Record<string, unknown>) => {
    request.mockImplementation(async (name: string) => {
        switch (name) {
            case 'tool:getVars':
                return vars
            case 'map:getBasemapStyles':
                return []
            case 'map:getBasemap':
                return null
            default:
                return { ok: true }
        }
    })
}

const actionButton = (container: HTMLElement) =>
    container.querySelector('.blocks-map-control__btn--action')

beforeEach(() => {
    request = vi.fn()
    withVars({})
    ;(window as { mmgisAPI?: unknown }).mmgisAPI = {
        request,
        hasHandler: () => true,
        emit: vi.fn(),
        on: () => () => {},
    }
    vi.spyOn(window, 'open').mockImplementation(() => null)
})

afterEach(() => {
    delete (window as { mmgisAPI?: unknown }).mmgisAPI
    document.body.innerHTML = ''
    vi.restoreAllMocks()
})

describe('MMGISMapControlAdapter action button', () => {
    test('is absent for a mission that configures no link', async () => {
        const { container, unmount } = await mount(<MMGISMapControlAdapter />)

        expect(actionButton(container)).toBeNull()

        await unmount()
    })

    test('is absent when the link is only whitespace', async () => {
        withVars({ actionButtonLink: '   ' })
        const { container, unmount } = await mount(<MMGISMapControlAdapter />)

        expect(actionButton(container)).toBeNull()

        await unmount()
    })

    describe.each([
        ['a boolean', true],
        ['a number', 0],
        ['an object', {}],
        ['null', null],
        ['an array', ['panels:show:left']],
    ])('a link configured as %s', (_label, value) => {
        test('renders the bar without an action button, and does not throw', async () => {
            withVars({ actionButtonLink: value })

            const mounted = await mount(<MMGISMapControlAdapter />)

            // The bar itself survives — the point of the guard, since a throw
            // here would leave the mission with no map controls at all.
            expect(
                mounted.container.querySelector('.blocks-map-control__bar'),
            ).not.toBeNull()
            // An action is only ever a string — a URL, a namespaced core
            // request or an event name — so every other type reads as unset
            // rather than becoming an event named '0' or '[object Object]'.
            expect(actionButton(mounted.container)).toBeNull()

            await mounted.unmount()
        })
    })

    test('runs the configured link when clicked', async () => {
        withVars({ actionButtonLink: LINK, actionButtonText: 'Run statistics' })
        const { container, unmount } = await mount(<MMGISMapControlAdapter />)

        await click(actionButton(container)!)

        expect(window.open).toHaveBeenCalledWith(LINK, '_blank', 'noopener,noreferrer')

        await unmount()
    })

    test('never exposes the action string as the button\'s name', async () => {
        withVars({
            actionButtonLink: 'plugins:show:DrawTool',
            actionButtonText: 'Draw',
        })
        const { container, unmount } = await mount(<MMGISMapControlAdapter />)

        const button = actionButton(container)!
        // The configured text names the button everywhere a reader meets it;
        // the action string is wiring and belongs in neither the tooltip nor
        // the accessible name.
        expect(button.getAttribute('aria-label')).toBe('Draw')
        expect(button.getAttribute('title')).toBe('Draw')
        expect(button.outerHTML).not.toContain('plugins:show:DrawTool')

        await unmount()
    })

    test('leaves the label to the bar when the mission names none', async () => {
        withVars({ actionButtonLink: LINK })
        const { container, unmount } = await mount(<MMGISMapControlAdapter />)

        expect(actionButton(container)?.textContent).toBe('Analyze area')

        await unmount()
    })
})
