import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolveAction, TARGET_PARAM } from '../resolveAction'

// Loaded only for the "handlers are actually registered" check below — it
// pulls in the real core bus, not the window.mmgisAPI stand-in the rest of
// this file uses. Viewer_ drags in JSX aggregators the import-analyzer can't
// parse, so it's stubbed the same way the provider specs stub it.
vi.mock('../../../../Basics/Viewer_/Viewer_', () => ({ default: {} }))
import { mmgisAPI as coreMmgisAPI } from '../../../../mmgisAPI/mmgisAPI'

const request = vi.fn()
const emit = vi.fn()

beforeEach(() => {
    request.mockReset().mockResolvedValue({ ok: true })
    emit.mockReset()
    ;(window as any).mmgisAPI = { request, emit, on: () => () => {} }
    vi.spyOn(window, 'open').mockImplementation(() => null)
})

afterEach(() => vi.restoreAllMocks())

describe('resolveAction', () => {
    test('opens external links in a new tab', async () => {
        await resolveAction('https://example.com/docs')
        expect(window.open).toHaveBeenCalledWith(
            'https://example.com/docs', '_blank', 'noopener,noreferrer'
        )
        expect(request).not.toHaveBeenCalled()
    })

    test('maps a panel action to a panelId request', async () => {
        await resolveAction('panels:hide:left-panel')
        expect(request).toHaveBeenCalledWith('panels:hide', { panelId: 'left-panel' })
    })

    test('maps a plugin action to a pluginId request', async () => {
        await resolveAction('plugins:show:DrawTool')
        expect(request).toHaveBeenCalledWith('plugins:show', { pluginId: 'DrawTool' })
    })

    test('preserves colons inside a target', async () => {
        await resolveAction('panels:hide:group:left')
        expect(request).toHaveBeenCalledWith('panels:hide', { panelId: 'group:left' })
    })

    test('emits anything else as a plain event', async () => {
        await resolveAction('plugin:title:refresh')
        expect(emit).toHaveBeenCalledWith('plugin:title:refresh', undefined)
        expect(request).not.toHaveBeenCalled()
    })

    test('emits an un-namespaced action, but warns that nothing will hear it', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        await resolveAction('refresh')

        // Still emitted verbatim — a bare event name is legal.
        expect(emit).toHaveBeenCalledWith('refresh', undefined)
        // But it reaches no `plugin:<toolId>:` listener, so it is called out
        // and the warning names the form the author most likely wanted.
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('"refresh" has no namespace'),
        )
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('plugin:<toolId>:refresh'),
        )
    })

    test('a namespaced custom event is emitted with no warning', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        await resolveAction('LayerManager:someEvent')

        expect(emit).toHaveBeenCalledWith('LayerManager:someEvent', undefined)
        expect(warn).not.toHaveBeenCalled()
    })

    test('does nothing for an empty action', async () => {
        await resolveAction('')
        expect(request).not.toHaveBeenCalled()
        expect(emit).not.toHaveBeenCalled()
    })

    test('warns when a request is refused', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        request.mockResolvedValue({ ok: false, reason: 'not-found' })
        await resolveAction('panels:hide:ghost')
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('not-found')
        )
    })

    test('warns instead of silently emitting when a known verb has no target', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        await resolveAction('panels:hide')
        expect(request).not.toHaveBeenCalled()
        expect(emit).not.toHaveBeenCalled()
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('panels:hide'))
    })

    test('does not treat a core namespace typed in the wrong case as a core action', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        await resolveAction('Panels:Hide:left-panel')
        expect(request).not.toHaveBeenCalled()
        expect(warn).not.toHaveBeenCalled()
        expect(emit).toHaveBeenCalledWith('Panels:Hide:left-panel', undefined)
    })

    test('warns on an unrecognised verb under a core namespace', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        await resolveAction('panels:hdie:left-panel')
        expect(request).not.toHaveBeenCalled()
        expect(emit).not.toHaveBeenCalled()
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('panels:hdie:left-panel'))
    })

    test('warns on a "core:" action string instead of emitting it', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        await resolveAction('core:showPlugin:LayersTool')
        expect(request).not.toHaveBeenCalled()
        expect(emit).not.toHaveBeenCalled()
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('core:showPlugin:LayersTool'))
    })

    test('warns "no handler" rather than "undefined" when the bus is absent', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        delete (window as any).mmgisAPI
        await resolveAction('panels:hide:left-panel')
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('no handler'))
    })

    test('a rejected request is caught and warned, not thrown', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        request.mockRejectedValue(new Error('no handler registered for panels:hide'))
        await expect(resolveAction('panels:hide:left-panel')).resolves.toBeUndefined()
        expect(warn).toHaveBeenCalled()
    })
})

describe('resolveAction TARGET_PARAM registration', () => {
    // A rename on either side — the table here or the provider that answers
    // the request — must not degrade silently into the plain-emit branch.
    test('every TARGET_PARAM entry has a handler registered on the real bus', () => {
        for (const name of Object.keys(TARGET_PARAM)) {
            expect(coreMmgisAPI.hasHandler(name)).toBe(true)
        }
    })

})
