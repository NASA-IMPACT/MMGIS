import React from 'react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { MMGISMapControlAdapter } from '../MMGISMapControlAdapter'
import { mount, click } from '../../_shared/__tests__/reactHarness'

// The webpack build routes the trigger's glyph through @svgr, which exports it
// as `ReactComponent`; vitest treats the file as a plain asset, so that export
// is missing. Nothing here asserts on the glyph.
vi.mock('../../_shared/share/share-map.svg', () => ({
    ReactComponent: () => null,
}))

/**
 * `tool:getVars` hands back the mission JSON's `variables` verbatim, so these
 * cases feed the bus the shapes a config author can produce and assert on what
 * the bar renders. The adapter mounts with no error boundary, so a value it
 * treats as text without checking takes the whole bar down.
 *
 * Clicking is asserted through `window.open`, the seam an `https://` action
 * ends at; the other action forms are covered in resolveAction's own spec.
 */

const LINK = 'https://example.com/analysis'
/** Where the loaded mission's files are served from, as core reports it. */
const MISSION_PATH = 'Missions/Test/'

let request: ReturnType<typeof vi.fn>

/** Answer the bus with one mission's tool variables. */
const withVars = (vars: Record<string, unknown>) => {
    request.mockImplementation(async (name: string) => {
        switch (name) {
            case 'tool:getVars':
                return vars
            case 'app:getMissionPath':
                return MISSION_PATH
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

            expect(
                mounted.container.querySelector('.blocks-map-control__bar'),
            ).not.toBeNull()
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
        expect(button.getAttribute('aria-label')).toBe('Draw')
        expect(button.getAttribute('title')).toBe('Draw')
        expect(button.outerHTML).not.toContain('plugins:show:DrawTool')

        await unmount()
    })

    test('falls back to generic wording when neither text nor icon is configured', async () => {
        withVars({ actionButtonLink: LINK })
        const { container, unmount } = await mount(<MMGISMapControlAdapter />)

        expect(actionButton(container)?.textContent).toBe('Analyze area')

        await unmount()
    })
})

/**
 * The icon is configured across four fields: a source naming which of three
 * inputs supplies the glyph, and the three inputs themselves. What matters is
 * which field a given combination draws from, that an uploaded file is pointed
 * at the path the mission serves it from, that a font name arrives as a class
 * the stylesheet can draw, and that anything unusable warns and leaves the
 * button as if no icon were configured.
 */
describe('MMGISMapControlAdapter action button icon', () => {
    const fontIcon = (container: HTMLElement) =>
        container.querySelector('.blocks-map-control__btn--action i')

    const imageIcon = (container: HTMLElement) =>
        container.querySelector<HTMLElement>(
            '.blocks-map-control__btn-icon--image',
        )

    const anyIcon = (container: HTMLElement) =>
        container.querySelector('.blocks-map-control__btn-icon')

    test('points an uploaded file at the mission that stores it', async () => {
        withVars({
            actionButtonLink: LINK,
            actionButtonIconSource: 'upload',
            // What the upload endpoint stores: a mission-relative path, which
            // the browser cannot fetch as written.
            actionButtonIconUpload: 'MapControl/uploads/ab12.svg',
            actionButtonIconUrl: 'https://example.com/other.svg',
            actionButtonIconMdi: 'poll',
        })
        const { container, unmount } = await mount(<MMGISMapControlAdapter />)

        expect(imageIcon(container)?.style.maskImage).toBe(
            'url("Missions/Test/MapControl/uploads/ab12.svg")',
        )
        expect(fontIcon(container)).toBeNull()

        await unmount()
    })

    test('leaves an already-absolute upload value alone', async () => {
        withVars({
            actionButtonLink: LINK,
            actionButtonIconSource: 'upload',
            actionButtonIconUpload: '/assets/shared/glyph.svg',
        })
        const { container, unmount } = await mount(<MMGISMapControlAdapter />)

        expect(imageIcon(container)?.style.maskImage).toBe(
            'url("/assets/shared/glyph.svg")',
        )

        await unmount()
    })

    test('draws the linked file the source names, without a mission prefix', async () => {
        withVars({
            actionButtonLink: LINK,
            actionButtonIconSource: 'link',
            actionButtonIconUpload: 'MapControl/uploads/ab12.svg',
            actionButtonIconUrl: 'https://example.com/other.svg',
            actionButtonIconMdi: 'poll',
        })
        const { container, unmount } = await mount(<MMGISMapControlAdapter />)

        expect(imageIcon(container)?.style.maskImage).toBe(
            'url("https://example.com/other.svg")',
        )

        await unmount()
    })

    test('draws the icon-set export name as the class the stylesheet uses', async () => {
        withVars({
            actionButtonLink: LINK,
            actionButtonIconSource: 'mdi',
            actionButtonIconMdi: 'mdiPoll',
        })
        const { container, unmount } = await mount(<MMGISMapControlAdapter />)

        expect(fontIcon(container)?.getAttribute('class')).toBe(
            'mdi mdi-poll blocks-map-control__btn-icon',
        )

        await unmount()
    })

    test('leaves a full class untouched', async () => {
        withVars({
            actionButtonLink: LINK,
            actionButtonIconSource: 'mdi',
            actionButtonIconMdi: 'mdi mdi-poll',
        })
        const { container, unmount } = await mount(<MMGISMapControlAdapter />)

        expect(fontIcon(container)?.getAttribute('class')).toBe(
            'mdi mdi-poll blocks-map-control__btn-icon',
        )

        await unmount()
    })

    test('falls back to the field that is filled when the source names an empty one', async () => {
        withVars({
            actionButtonLink: LINK,
            actionButtonIconSource: 'upload',
            actionButtonIconMdi: 'poll',
        })
        const { container, unmount } = await mount(<MMGISMapControlAdapter />)

        expect(fontIcon(container)?.getAttribute('class')).toBe(
            'mdi mdi-poll blocks-map-control__btn-icon',
        )

        await unmount()
    })

    test('draws the only filled field when no source is named', async () => {
        withVars({
            actionButtonLink: LINK,
            actionButtonIconUrl: 'https://example.com/glyph.png',
        })
        const { container, unmount } = await mount(<MMGISMapControlAdapter />)

        expect(imageIcon(container)?.style.maskImage).toBe(
            'url("https://example.com/glyph.png")',
        )

        await unmount()
    })

    test('lets the glyph stand alone when the mission names no text', async () => {
        withVars({
            actionButtonLink: LINK,
            actionButtonIconSource: 'mdi',
            actionButtonIconMdi: 'mdiPoll',
        })
        const { container, unmount } = await mount(<MMGISMapControlAdapter />)

        expect(fontIcon(container)).not.toBeNull()
        // A glyph already names the action, so no fallback wording joins it.
        expect(actionButton(container)?.textContent).toBe('')

        await unmount()
    })

    test('warns and renders no icon for a value naming no icon', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        withVars({
            actionButtonLink: LINK,
            actionButtonIconSource: 'mdi',
            actionButtonIconMdi: 'Not An Icon',
        })
        const { container, unmount } = await mount(<MMGISMapControlAdapter />)

        expect(anyIcon(container)).toBeNull()
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('Not An Icon'),
        )
        // With no usable glyph the button is back to needing a name.
        expect(actionButton(container)?.textContent).toBe('Analyze area')

        await unmount()
    })

    test('warns when the named source is the only thing configured', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        withVars({ actionButtonLink: LINK, actionButtonIconSource: 'upload' })
        const { container, unmount } = await mount(<MMGISMapControlAdapter />)

        expect(anyIcon(container)).toBeNull()
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('"upload"'))

        await unmount()
    })

    test('renders no icon for a mission that configures none', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        withVars({ actionButtonLink: LINK })
        const { container, unmount } = await mount(<MMGISMapControlAdapter />)

        expect(anyIcon(container)).toBeNull()
        // An empty icon config is the common case and must stay quiet.
        expect(warn).not.toHaveBeenCalled()

        await unmount()
    })

    describe.each([
        ['a boolean', true],
        ['a number', 7],
        ['an object', { src: 'glyph.svg' }],
        ['null', null],
        ['an array', ['glyph.svg']],
    ])('icon fields configured as %s', (_label, value) => {
        test('render the bar without an icon, and do not throw', async () => {
            withVars({
                actionButtonLink: LINK,
                actionButtonIconSource: value,
                actionButtonIconUpload: value,
                actionButtonIconUrl: value,
                actionButtonIconMdi: value,
            })

            const mounted = await mount(<MMGISMapControlAdapter />)

            expect(
                mounted.container.querySelector('.blocks-map-control__bar'),
            ).not.toBeNull()
            expect(anyIcon(mounted.container)).toBeNull()

            await mounted.unmount()
        })
    })
})
