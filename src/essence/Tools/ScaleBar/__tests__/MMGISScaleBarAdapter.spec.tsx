import React from 'react'
import { act } from 'react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { MMGISScaleBarAdapter } from '../MMGISScaleBarAdapter'
import { mount } from '../../_shared/__tests__/reactHarness'

/**
 * The adapter against a fake bus: tool variables and the map's scale come
 * from `request`, bus events are captured from `on` so a spec can fire them,
 * and whatever the adapter `provide`s is kept so a spec can call it as an
 * export would.
 */

let vars: Record<string, unknown>
let metersPerPixel: number | null
let listeners: Map<string, Set<(payload?: unknown) => void>>
let provided: Map<string, (...args: unknown[]) => unknown>

const fire = async (event: string) => {
    await act(async () => {
        for (const handler of listeners.get(event) ?? []) handler()
    })
}

const label = (container: HTMLElement) =>
    container.querySelector('.blocks-scale-bar__label')?.textContent ?? null

// jsdom does no layout, so nothing has client rects; a bar the page shows
// is simulated by giving its host one.
const showHost = (container: HTMLElement) => {
    const host = container.querySelector('.blocks-scale-bar-host') as HTMLElement
    host.getClientRects = () => [{}] as unknown as DOMRectList
}

beforeEach(() => {
    vars = {}
    metersPerPixel = 1
    listeners = new Map()
    provided = new Map()
    ;(window as { mmgisAPI?: unknown }).mmgisAPI = {
        request: vi.fn(async (name: string) => {
            if (name === 'tool:getVars') return vars
            if (name === 'map:getMetersPerPixel') return metersPerPixel
            return null
        }),
        hasHandler: () => true,
        emit: vi.fn(),
        on: (event: string, handler: (payload?: unknown) => void) => {
            if (!listeners.has(event)) listeners.set(event, new Set())
            listeners.get(event)!.add(handler)
            return () => listeners.get(event)!.delete(handler)
        },
        provide: (name: string, handler: (...args: unknown[]) => unknown) => {
            provided.set(name, handler)
            return () => provided.delete(name)
        },
    }
})

afterEach(() => {
    delete (window as { mmgisAPI?: unknown }).mmgisAPI
    document.body.innerHTML = ''
    vi.restoreAllMocks()
})

describe('MMGISScaleBarAdapter', () => {
    test('a mission that never chose units gets metric', async () => {
        const { container, unmount } = await mount(<MMGISScaleBarAdapter />)
        expect(label(container)).toBe('100 m')
        const rule = container.querySelector('.blocks-scale-bar__rule') as HTMLElement
        expect(rule.style.width).toBe('100px')
        await unmount()
    })

    test('imperial units label the bar in feet', async () => {
        vars = { units: 'imperial' }
        const { container, unmount } = await mount(<MMGISScaleBarAdapter />)
        expect(label(container)).toBe('200 ft')
        await unmount()
    })

    test.each(['map:move', 'map:moveend'])(
        'rereads the scale on %s',
        async (event) => {
            const { container, unmount } = await mount(<MMGISScaleBarAdapter />)
            metersPerPixel = 10
            await fire(event)
            expect(label(container)).toBe('1 km')
            await unmount()
        },
    )

    // Map scale varies across the screen, so the bar asks for it where its
    // rule starts: the host's bottom-left corner.
    test('asks for the scale at its own position on the page', async () => {
        const { container, unmount } = await mount(<MMGISScaleBarAdapter />)
        showHost(container)
        const host = container.querySelector('.blocks-scale-bar-host') as HTMLElement
        host.getBoundingClientRect = () => ({ left: 24, bottom: 580 }) as DOMRect
        await fire('map:move')
        const request = (window as unknown as {
            mmgisAPI: { request: ReturnType<typeof vi.fn> }
        }).mmgisAPI.request
        expect(request).toHaveBeenLastCalledWith('map:getMetersPerPixel', {
            clientX: 24,
            clientY: 580,
        })
        await unmount()
    })

    // A map whose basemap loads asynchronously has no scale when the plugin
    // first asks; the bar appears once it does, without a zoom or pan.
    test('keeps asking until the map has a scale', async () => {
        vi.useFakeTimers()
        try {
            metersPerPixel = null
            const { container, unmount } = await mount(<MMGISScaleBarAdapter />)
            expect(container.querySelector('.blocks-scale-bar')).toBeNull()
            metersPerPixel = 1
            await act(async () => {
                await vi.advanceTimersByTimeAsync(300)
            })
            expect(label(container)).toBe('100 m')
            await unmount()
        } finally {
            vi.useRealTimers()
        }
    })

    test('stops asking once unmounted', async () => {
        vi.useFakeTimers()
        try {
            metersPerPixel = null
            const { unmount } = await mount(<MMGISScaleBarAdapter />)
            await unmount()
            const request = (window as unknown as {
                mmgisAPI: { request: ReturnType<typeof vi.fn> }
            }).mmgisAPI.request
            const calls = request.mock.calls.length
            await vi.advanceTimersByTimeAsync(2000)
            expect(request.mock.calls.length).toBe(calls)
        } finally {
            vi.useRealTimers()
        }
    })

    test('an unknown scale shows no bar', async () => {
        metersPerPixel = null
        const { container, unmount } = await mount(<MMGISScaleBarAdapter />)
        expect(container.querySelector('.blocks-scale-bar')).toBeNull()
        await unmount()
    })

    describe('export settings', () => {
        const settings = () => {
            const handler = provided.get('plugin:scalebar:getSettings')
            if (!handler) throw new Error('getSettings was not provided')
            return handler()
        }

        test('answer with the units while the bar is on screen', async () => {
            vars = { units: 'imperial' }
            const { container, unmount } = await mount(<MMGISScaleBarAdapter />)
            showHost(container)
            expect(settings()).toEqual({ units: 'imperial' })
            await unmount()
        })

        // A hidden plugin stays mounted; its bar is not on the map, so it
        // must not appear in the export either.
        test('answer null while the bar is hidden', async () => {
            const { unmount } = await mount(<MMGISScaleBarAdapter />)
            expect(settings()).toBeNull()
            await unmount()
        })

        test('stop answering once the plugin is gone', async () => {
            const { unmount } = await mount(<MMGISScaleBarAdapter />)
            expect(provided.has('plugin:scalebar:getSettings')).toBe(true)
            await unmount()
            expect(provided.has('plugin:scalebar:getSettings')).toBe(false)
        })
    })
})
