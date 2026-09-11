import React, { act } from 'react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { MMGISLayerManagerAdapter } from '../MMGISLayerManagerAdapter'
import { mount as mountOnce, type Mounted } from '../../_shared/__tests__/reactHarness'
import type { LayerDataCoverage } from '../../_shared/adapters/mmgisAPI'

/**
 * Where the panel meets core's coverage record. The adapter reads every
 * layer's record with the rest of the row data, follows core's announcements
 * of a change to one, and hands the row a way to read its record afresh. Core
 * is a fake bus here: request handlers plus a real subscriber list, so an
 * announcement reaches exactly the handlers still subscribed to it.
 *
 * Layer UUIDs and display names differ on purpose, since every map crossing
 * the bus is UUID-keyed and a lookup by the wrong one must fail here.
 */

/**
 * Every panel still mounted, unmounted after each case. A case unmounts its
 * own at its end, which a failing assertion skips; a panel left behind keeps
 * its document-level Escape and press listeners acting on the cases after it.
 */
const mounted = new Set<Mounted>()

const mount = async (ui: React.ReactElement): Promise<Mounted> => {
    const handle = await mountOnce(ui)
    const tracked: Mounted = {
        ...handle,
        unmount: async () => {
            if (!mounted.delete(tracked)) return
            await handle.unmount()
        },
    }
    mounted.add(tracked)
    return tracked
}

const unmountAll = async () => {
    for (const handle of [...mounted]) await handle.unmount()
}

const SPARSE = 'Sparse_0123456789abcdef'
const CONTINUOUS = 'Continuous_fedcba9876543210'
const STATIC = 'Static_00112233445566'

const CONFIGS: Record<string, { display_name: string; time?: object }> = {
    [SPARSE]: { display_name: 'Sparse', time: { enabled: true } },
    [CONTINUOUS]: { display_name: 'Continuous', time: { enabled: true } },
    [STATIC]: { display_name: 'Static' },
}

const COVERAGE_EVENT = 'layers:dataCoverageChanged'

const utc = (...parts: [number, number, number, number?]) => Date.UTC(...parts)

const window_ = (end: number) => ({ start: end - 86400000, end })

const sparseRecord = (outOfDataRange: boolean, end = utc(2020, 3, 2)) => ({
    outOfDataRange,
    kind: 'sparse' as const,
    spans: [
        {
            start: utc(2020, 2, 4),
            end: utc(2020, 2, 5) - 1,
            at: utc(2020, 2, 4),
            unit: 'day' as const,
        },
    ],
    requestedWindow: window_(end),
})

const continuousRecord = (outOfDataRange: boolean, end = utc(2020, 3, 2)) => ({
    outOfDataRange,
    kind: 'continuous' as const,
    spans: [{ start: utc(2020, 0, 1), end: utc(2020, 2, 2) - 1 }],
    requestedWindow: window_(end),
})

const NO_COVERAGE: LayerDataCoverage = {
    outOfDataRange: false,
    kind: null,
    spans: null,
    requestedWindow: window_(utc(2020, 3, 2)),
}

/** Core's registry, keyed by layer UUID. Tests edit it to move core on. */
let registry: Record<string, LayerDataCoverage>
let listeners: Map<string, Set<(payload?: unknown) => void>>
let requests: Array<{ name: string; params: unknown }>
/**
 * Gates for the next 'layers:getVisible' calls, taken one per call. A refresh
 * that meets one has already read the coverage map and waits there until the
 * gate is released.
 */
let visibleGates: Promise<void>[]
let provideCoverage: boolean

const installBus = () => {
    listeners = new Map()
    requests = []
    visibleGates = []
    const handlers: Record<string, (params?: unknown) => unknown> = {
        'layers:getAll': () => ({}),
        'tool:getVars': () => ({}),
        'layers:getAllConfigs': () => CONFIGS,
        'layers:getVisible': async () => {
            const gate = visibleGates.shift()
            if (gate) await gate
            return { [SPARSE]: true, [CONTINUOUS]: true, [STATIC]: true }
        },
        'layers:getAllOpacities': () => ({}),
        // Core answers one layer by UUID or display name, or the whole map.
        // The map is copied, so a read is a snapshot of the moment it ran.
        'layers:getDataCoverage': (id) => {
            if (id == null) return { ...registry }
            const uuid = Object.keys(CONFIGS).find(
                (key) => key === id || CONFIGS[key].display_name === id,
            )
            return uuid ? registry[uuid] ?? null : null
        },
    }
    ;(window as { mmgisAPI?: unknown }).mmgisAPI = {
        request: async (name: string, params?: unknown) => {
            requests.push({ name, params })
            const handler = handlers[name]
            if (!handler || (name === 'layers:getDataCoverage' && !provideCoverage))
                throw new Error(`No handler for ${name}`)
            return handler(params)
        },
        hasHandler: (name: string) =>
            name in handlers &&
            (name !== 'layers:getDataCoverage' || provideCoverage),
        on: (event: string, handler: (payload?: unknown) => void) => {
            if (!listeners.has(event)) listeners.set(event, new Set())
            listeners.get(event)!.add(handler)
            return () => {
                listeners.get(event)?.delete(handler)
            }
        },
        emit: (event: string, payload?: unknown) => {
            for (const handler of [...(listeners.get(event) ?? [])]) handler(payload)
        },
    }
}

/** What core does when a record changes: store it, then announce it. */
const announce = async (layerName: string, record: LayerDataCoverage) => {
    registry[layerName] = record
    await act(async () => {
        ;(window as any).mmgisAPI.emit(COVERAGE_EVENT, { layerName, ...record })
    })
}

/** Let the refresh's chain of bus requests settle. */
const settle = async () => {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
    })
}

const rowOf = (container: HTMLElement, id: string) =>
    container.querySelector<HTMLElement>(`[data-legend-id="${id}"]`)

const flagged = (container: HTMLElement) =>
    Array.from(
        container.querySelectorAll('.blocks-layer-legend__coverage-warning'),
    ).map((el) => el.closest('[data-legend-id]')!.getAttribute('data-legend-id'))

const popovers = () =>
    Array.from(
        document.body.querySelectorAll('.blocks-layer-legend__coverage-popover'),
    )

/** Hold the next refresh once it has read the coverage map. */
const holdNextRefresh = (): (() => void) => {
    let release!: () => void
    visibleGates.push(
        new Promise<void>((resolve) => {
            release = resolve
        }),
    )
    return release
}

/** What core broadcasts when its layer list changes, which refreshes the panel. */
const listChanged = async () => {
    await act(async () => {
        ;(window as any).mmgisAPI.emit('layers:listChanged')
    })
}

const hover = async (el: Element) => {
    await act(async () => {
        el.dispatchEvent(
            new MouseEvent('pointerover', {
                bubbles: true,
                relatedTarget: document.body,
            }),
        )
    })
}

const mountAdapter = async (): Promise<Mounted> => {
    const mounted = await mount(<MMGISLayerManagerAdapter />)
    await settle()
    return mounted
}

beforeEach(() => {
    registry = {}
    provideCoverage = true
    installBus()
})

afterEach(async () => {
    await unmountAll()
    vi.restoreAllMocks()
    delete (window as { mmgisAPI?: unknown }).mmgisAPI
    // Unmounting takes each panel's portals with it; anything still here
    // escaped React and would be counted by the next case.
    for (const el of popovers()) el.remove()
})

describe('MMGISLayerManagerAdapter data coverage', () => {
    test('flags a layer core was already suppressing when the panel opens', async () => {
        registry = {
            [SPARSE]: sparseRecord(true),
            [CONTINUOUS]: continuousRecord(false),
            [STATIC]: NO_COVERAGE,
        }
        const { container, unmount } = await mountAdapter()

        expect(rowOf(container, STATIC)).not.toBeNull()
        expect(flagged(container)).toEqual([SPARSE])
        await unmount()
    })

    test('patches the row a change names, and only that row', async () => {
        registry = {
            [SPARSE]: sparseRecord(true),
            [CONTINUOUS]: continuousRecord(false),
            [STATIC]: NO_COVERAGE,
        }
        const { container, unmount } = await mountAdapter()

        await announce(CONTINUOUS, continuousRecord(true))
        expect(flagged(container)).toEqual([SPARSE, CONTINUOUS])

        await announce(SPARSE, sparseRecord(false))
        expect(flagged(container)).toEqual([CONTINUOUS])

        // A layer the list does not hold changes nothing.
        await announce('Elsewhere_ffffffffffffffff', sparseRecord(true))
        expect(flagged(container)).toEqual([CONTINUOUS])
        await unmount()
    })

    test('keeps a change announced while a refresh was reading', async () => {
        registry = { [SPARSE]: sparseRecord(false) }
        const { container, unmount } = await mountAdapter()
        expect(flagged(container)).toEqual([])

        // Hold the next refresh after it has read the coverage map, then
        // announce a change it cannot have seen.
        const release = holdNextRefresh()
        await listChanged()
        await announce(SPARSE, sparseRecord(true))
        expect(flagged(container)).toEqual([SPARSE])

        release()
        await settle()
        expect(flagged(container)).toEqual([SPARSE])
        await unmount()
    })

    // Each refresh lands with what it read, so the one that finishes last
    // decides the rows — here the one that read first.
    test('keeps every change across refreshes that overlap and land out of order', async () => {
        registry = {
            [SPARSE]: sparseRecord(false),
            [CONTINUOUS]: continuousRecord(false),
        }
        const { container, unmount } = await mountAdapter()

        const releaseFirst = holdNextRefresh()
        await listChanged()
        await announce(SPARSE, sparseRecord(true))

        const releaseSecond = holdNextRefresh()
        await listChanged()
        await announce(CONTINUOUS, continuousRecord(true))
        expect(flagged(container)).toEqual([SPARSE, CONTINUOUS])

        releaseSecond()
        await settle()
        expect(flagged(container)).toEqual([SPARSE, CONTINUOUS])

        // The first read predates both changes.
        releaseFirst()
        await settle()
        expect(flagged(container)).toEqual([SPARSE, CONTINUOUS])
        await unmount()
    })

    test('closing the panel mid-refresh leaves nothing behind', async () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
        registry = { [SPARSE]: sparseRecord(true) }
        const { unmount } = await mountAdapter()

        const release = holdNextRefresh()
        await listChanged()
        await unmount()
        expect(listeners.get(COVERAGE_EVENT)?.size ?? 0).toBe(0)

        release()
        await settle()
        await announce(SPARSE, sparseRecord(false))
        expect(errors).not.toHaveBeenCalled()
        expect(popovers()).toHaveLength(0)
    })

    // The window moves on every time step while core announces only changes
    // of verdict or coverage, so the popover reads the record as it stands.
    test('reads the record over the bus when the popover opens', async () => {
        registry = { [SPARSE]: sparseRecord(true, utc(2020, 3, 2)) }
        const { container, unmount } = await mountAdapter()

        // A later time step: stored by core, not announced.
        registry[SPARSE] = sparseRecord(true, utc(2020, 4, 9, 14))

        const warning = rowOf(container, SPARSE)!.querySelector(
            '.blocks-layer-legend__coverage-warning',
        )!
        await hover(warning)
        await settle()

        expect(requests).toContainEqual({
            name: 'layers:getDataCoverage',
            params: SPARSE,
        })
        const [popover] = popovers()
        expect(popover.textContent).toContain('Requested 2020-05-09 14:00 UTC')
        expect(popover.textContent).toContain('Data available on 2020-03-04')
        await unmount()
    })

    test('closing the panel drops its subscription and its popovers', async () => {
        registry = { [SPARSE]: sparseRecord(true) }
        const { container, unmount } = await mountAdapter()
        expect(listeners.get(COVERAGE_EVENT)?.size).toBe(1)

        const warning = container.querySelector(
            '.blocks-layer-legend__coverage-warning',
        )!
        await hover(warning)
        expect(popovers()).toHaveLength(1)

        await unmount()
        expect(listeners.get(COVERAGE_EVENT)?.size ?? 0).toBe(0)
        expect(popovers()).toHaveLength(0)
    })

    test('flags nothing against a core that serves no coverage', async () => {
        provideCoverage = false
        const { container, unmount } = await mountAdapter()

        expect(rowOf(container, SPARSE)).not.toBeNull()
        expect(flagged(container)).toEqual([])
        await unmount()
    })
})
