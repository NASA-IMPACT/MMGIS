import { describe, test, expect, afterEach, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MMGISTitleAdapter } from '../../src/essence/Tools/Title/MMGISTitleAdapter'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// The Title tool's logoLink variable wraps the title header (logo or fallback
// icon, plus the title text) in a single anchor that opens in a new tab. Only
// absolute http(s) URLs become links.
function makeBus({ logoUrl = '', ...vars } = {}) {
    const responses = {
        'app:getBranding': { mission: 'Demo', logoUrl },
        'tool:getVars': vars,
        'app:getMissionPath': 'Missions/Demo/',
    }
    return {
        hasHandler: (name) => name in responses,
        request: async (name) => responses[name] ?? null,
        on: () => () => {},
    }
}

let mounted = null

function unmount() {
    if (mounted) {
        act(() => mounted.root.unmount())
        mounted.host.remove()
        mounted = null
    }
}

async function renderTitle(busOptions) {
    unmount()
    window.mmgisAPI = makeBus(busOptions)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    mounted = { host, root }
    await act(async () => {
        root.render(React.createElement(MMGISTitleAdapter))
    })
    // Branding is applied once the mission name or, with the title text
    // hidden, the logo image appears.
    await vi.waitFor(() => {
        expect(
            host.textContent.includes('Demo') || !!host.querySelector('img'),
        ).toBe(true)
    })
    return host
}

describe('MMGISTitleAdapter logo link', () => {
    afterEach(() => {
        unmount()
        delete window.mmgisAPI
    })

    test('links the logo and title text together in one new-tab link', async () => {
        const host = await renderTitle({
            logoUrl: 'https://example.com/logo.png',
            logoLink: 'https://nasa.gov',
        })
        const links = host.querySelectorAll('a')
        expect(links).toHaveLength(1)
        const link = links[0]
        expect(link.getAttribute('href')).toBe('https://nasa.gov')
        expect(link.getAttribute('target')).toBe('_blank')
        expect(link.getAttribute('rel')).toBe('noopener noreferrer')
        expect(link.querySelector('img')).not.toBeNull()
        expect(link.textContent).toBe('Demo')
    })

    test('links the fallback icon when no logo image is set', async () => {
        const host = await renderTitle({ logoLink: 'http://example.com' })
        const link = host.querySelector('a.blocks-title__header--link')
        expect(link.getAttribute('href')).toBe('http://example.com')
        expect(link.querySelector('.mdi-earth')).not.toBeNull()
    })

    test('links the title text alone when the logo is hidden', async () => {
        const host = await renderTitle({
            logoLink: 'https://nasa.gov',
            showLogo: false,
        })
        const link = host.querySelector('a.blocks-title__header--link')
        expect(link.getAttribute('href')).toBe('https://nasa.gov')
        expect(link.querySelector('img, .mdi-earth')).toBeNull()
        expect(link.textContent).toBe('Demo')
    })

    test('links the logo alone when the title text is hidden', async () => {
        const host = await renderTitle({
            logoUrl: 'https://example.com/logo.png',
            logoLink: 'https://nasa.gov',
            showTitleText: false,
        })
        const link = host.querySelector('a.blocks-title__header--link')
        expect(link.querySelector('img')).not.toBeNull()
        expect(link.textContent).toBe('')
    })

    test('leaves the logo unlinked when logoLink is unset', async () => {
        const host = await renderTitle({
            logoUrl: 'https://example.com/logo.png',
        })
        expect(host.querySelector('a')).toBeNull()
        expect(host.querySelector('img')).not.toBeNull()
    })

    test.each(['javascript:alert(1)', 'example.com', '/relative/path', 123, true])(
        'ignores the non-http(s) value %s',
        async (logoLink) => {
            const host = await renderTitle({ logoLink })
            expect(host.querySelector('a')).toBeNull()
            expect(host.querySelector('.mdi-earth')).not.toBeNull()
            const hidden = await renderTitle({ logoLink, showLogo: false })
            expect(hidden.querySelector('a')).toBeNull()
        },
    )
})
