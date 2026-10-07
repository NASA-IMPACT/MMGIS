import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MMGISTitleAdapter } from '../../src/essence/Tools/Title/MMGISTitleAdapter'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// The branding logo reaches the title bar through resolveMissionAssetUrl: an
// uploaded image is stored as a path (mission-relative on disk, an
// "assets/..." key in lean mode) and only loads once resolved, while a full
// URL passes through untouched. With no logo, the default icon shows.
function makeBus(logoUrl) {
    const responses = {
        'app:getBranding': { mission: 'Demo', logoUrl },
        'tool:getVars': {},
        'app:getMissionPath': 'Missions/Demo/',
    }
    return {
        hasHandler: (name) => name in responses,
        request: async (name) => responses[name] ?? null,
        on: () => () => {},
    }
}

async function renderWithLogo(logoUrl) {
    window.mmgisAPI = makeBus(logoUrl)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => {
        root.render(React.createElement(MMGISTitleAdapter))
    })
    // Let the readiness poll fire and the branding requests settle.
    await act(async () => {
        await new Promise((r) => setTimeout(r, 0))
    })
    return { host, root }
}

describe('MMGISTitleAdapter logo', () => {
    let mounted

    afterEach(() => {
        act(() => mounted.root.unmount())
        mounted.host.remove()
        delete window.mmgisAPI
    })

    test('resolves an uploaded on-disk path against the mission path', async () => {
        mounted = await renderWithLogo('Branding/uploads/abc.png')
        const img = mounted.host.querySelector('img')
        expect(img.getAttribute('src')).toBe('Missions/Demo/Branding/uploads/abc.png')
    })

    test('keeps a lean-mode upload key relative to the page', async () => {
        mounted = await renderWithLogo('assets/Demo/Branding/uploads/abc.svg')
        const img = mounted.host.querySelector('img')
        expect(img.getAttribute('src')).toBe('assets/Demo/Branding/uploads/abc.svg')
    })

    test('passes an https URL through unchanged', async () => {
        mounted = await renderWithLogo('https://example.com/logo.png')
        const img = mounted.host.querySelector('img')
        expect(img.getAttribute('src')).toBe('https://example.com/logo.png')
    })

    test('shows the default icon when no logo is set', async () => {
        mounted = await renderWithLogo('')
        expect(mounted.host.querySelector('img')).toBeNull()
        expect(mounted.host.querySelector('.mdi-earth')).not.toBeNull()
    })
})
