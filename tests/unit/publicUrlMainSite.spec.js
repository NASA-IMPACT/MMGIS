import { test, expect, vi } from 'vitest'

// publicUrlMainSite is what the Configure CMS prepends to a link back into
// the app it administers. It is computed once, at module load, from the
// address the CMS itself was opened at — so each case navigates jsdom to one
// of those addresses and imports the module fresh.
//
// What every case checks is the same thing: the CMS's own "/configure"
// segment comes off and no trailing slash is left behind, because every
// caller appends its own "/…".

const loadAt = async (pathname) => {
    window.history.replaceState({}, '', pathname)
    vi.resetModules()
    return await import('../../configure/src/core/constants.js')
}

test.describe('publicUrlMainSite', () => {
    test('a CMS at the origin root names the origin and nothing else', async () => {
        const { publicUrlMainSite } = await loadAt('/configure/')
        expect(publicUrlMainSite).toBe(window.location.origin)
    })

    test('the slash-less form of that address answers the same', async () => {
        const { publicUrlMainSite } = await loadAt('/configure')
        expect(publicUrlMainSite).toBe(window.location.origin)
    })

    test('a CMS under a ROOT_PATH keeps the prefix', async () => {
        const { publicUrlMainSite } = await loadAt('/mmgis/configure/')
        expect(publicUrlMainSite).toBe(`${window.location.origin}/mmgis`)
    })
})
