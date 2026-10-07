import { describe, test, expect, afterEach, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MMGISTitleAdapter } from '../../src/essence/Tools/Title/MMGISTitleAdapter'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// The Title tool's logoLink variable wraps the logo (or the fallback icon) in
// an anchor that opens in a new tab. Only absolute http(s) URLs become links.
function makeBus({ logoUrl = '', logoLink } = {}) {
    const responses = {
        'app:getBranding': { mission: 'Demo', logoUrl },
        'tool:getVars': logoLink === undefined ? {} : { logoLink },
        'app:getMissionPath': 'Missions/Demo/',
    }
    return {
        hasHandler: (name) => name in responses,
        request: async (name) => responses[name] ?? null,
        on: () => () => {},
    }
}

let mounted = null

async function renderTitle(busOptions) {
    window.mmgisAPI = makeBus(busOptions)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    mounted = { host, root }
    await act(async () => {
        root.render(React.createElement(MMGISTitleAdapter))
    })
    await vi.waitFor(() => {
        expect(host.textContent).toContain('Demo')
    })
    return host
}

describe('MMGISTitleAdapter logo link', () => {
    afterEach(() => {
        if (mounted) {
            act(() => mounted.root.unmount())
            mounted.host.remove()
            mounted = null
        }
        delete window.mmgisAPI
    })

    test('wraps the logo image in a new-tab link', async () => {
        const host = await renderTitle({
            logoUrl: 'https://example.com/logo.png',
            logoLink: 'https://nasa.gov',
        })
        const link = host.querySelector('a.blocks-title__logo-link')
        expect(link).not.toBeNull()
        expect(link.getAttribute('href')).toBe('https://nasa.gov')
        expect(link.getAttribute('target')).toBe('_blank')
        expect(link.getAttribute('rel')).toBe('noopener noreferrer')
        expect(link.querySelector('img')).not.toBeNull()
    })

    test('wraps the fallback icon when no logo image is set', async () => {
        const host = await renderTitle({ logoLink: 'http://example.com' })
        const link = host.querySelector('a.blocks-title__logo-link')
        expect(link.getAttribute('href')).toBe('http://example.com')
        expect(link.querySelector('.mdi-earth')).not.toBeNull()
    })

    test('leaves the logo unlinked when logoLink is unset', async () => {
        const host = await renderTitle({
            logoUrl: 'https://example.com/logo.png',
        })
        expect(host.querySelector('a')).toBeNull()
        expect(host.querySelector('img')).not.toBeNull()
    })

    test.each(['javascript:alert(1)', 'example.com', '/relative/path'])(
        'ignores the non-http(s) value %s',
        async (logoLink) => {
            const host = await renderTitle({ logoLink })
            expect(host.querySelector('a')).toBeNull()
            expect(host.querySelector('.mdi-earth')).not.toBeNull()
        },
    )
})
