import { describe, test, expect, afterEach, vi } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MMGISTitleAdapter } from '../../src/essence/Tools/Title/MMGISTitleAdapter'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

// The branding logo reaches the title bar through resolveMissionAssetUrl: an
// uploaded image is stored as a path (mission-relative on disk, an
// "assets/..." key in lean mode) and only loads once resolved, while a full
// URL passes through untouched. With no logo, the default icon shows.
function makeBus(logoUrl, { missionPath = 'provided' } = {}) {
    const responses = {
        'app:getBranding': { mission: 'Demo', logoUrl },
        'tool:getVars': {},
    }
    if (missionPath === 'provided') {
        responses['app:getMissionPath'] = 'Missions/Demo/'
    }
    return {
        hasHandler: (name) =>
            name in responses ||
            (missionPath === 'rejects' && name === 'app:getMissionPath'),
        request: async (name) => {
            if (missionPath === 'rejects' && name === 'app:getMissionPath') {
                throw new Error('mission path unavailable')
            }
            return responses[name] ?? null
        },
        on: () => () => {},
    }
}

let mounted = null

async function renderWithLogo(logoUrl, busOptions) {
    window.mmgisAPI = makeBus(logoUrl, busOptions)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    mounted = { host, root }
    await act(async () => {
        root.render(React.createElement(MMGISTitleAdapter))
    })
    // The mission name only appears once branding has been applied, so wait
    // for it rather than for a fixed number of ticks.
    await vi.waitFor(() => {
        expect(host.textContent).toContain('Demo')
    })
    return mounted
}

describe('MMGISTitleAdapter logo', () => {
    afterEach(() => {
        if (mounted) {
            act(() => mounted.root.unmount())
            mounted.host.remove()
            mounted = null
        }
        delete window.mmgisAPI
    })

    test('resolves an uploaded on-disk path against the mission path', async () => {
        await renderWithLogo('Branding/uploads/abc.png')
        const img = mounted.host.querySelector('img')
        expect(img.getAttribute('src')).toBe('Missions/Demo/Branding/uploads/abc.png')
    })

    test('keeps a lean-mode upload key relative to the page', async () => {
        await renderWithLogo('assets/Demo/Branding/uploads/abc.svg')
        const img = mounted.host.querySelector('img')
        expect(img.getAttribute('src')).toBe('assets/Demo/Branding/uploads/abc.svg')
    })

    test('passes an https URL through unchanged', async () => {
        await renderWithLogo('https://example.com/logo.png')
        const img = mounted.host.querySelector('img')
        expect(img.getAttribute('src')).toBe('https://example.com/logo.png')
    })

    test('shows the default icon when no logo is set', async () => {
        await renderWithLogo('')
        expect(mounted.host.querySelector('img')).toBeNull()
        expect(mounted.host.querySelector('.mdi-earth')).not.toBeNull()
    })

    test('still applies branding when the core has no mission path handler', async () => {
        await renderWithLogo('https://example.com/logo.png', {
            missionPath: 'absent',
        })
        const img = mounted.host.querySelector('img')
        expect(img.getAttribute('src')).toBe('https://example.com/logo.png')
    })

    test('still applies branding when the mission path request fails', async () => {
        await renderWithLogo('https://example.com/logo.png', {
            missionPath: 'rejects',
        })
        const img = mounted.host.querySelector('img')
        expect(img.getAttribute('src')).toBe('https://example.com/logo.png')
    })
})
