import { describe, test, expect, afterEach, vi } from 'vitest'

// Viewer_ pulls in Photosphere/ModelViewer/PDFViewer, which are JSX written in
// .js files that vite's import-analysis can't parse. Nothing here needs the
// real viewers, so stub the aggregator to keep the import chain parseable.
vi.mock('../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))

// Stand in the generated registry: bindings mapped to the addresses the build
// derived from them, and the classes those bindings reach. `PlainTool` is
// deliberately missing from `toolIds` so the frontend's own fallback
// derivation is exercised beside the generated map.
const { calls } = vi.hoisted(() => ({ calls: [] }))
vi.mock('../../src/pre/tools', () => ({
    Kinds: {},
    toolConfigs: {},
    testModules: {},
    toolIds: { FetchStatsTool: 'fetchstats' },
    toolModules: {
        // Records the address its injected handle carries at each lifecycle
        // step, so a test can see whether the handle was there before the tool
        // ran any of its own code.
        FetchStatsTool: {
            initialize() {
                calls.push(['initialize', this.api?.address])
                this.api.provide('getSelection', () => 'a selection')
            },
            make() {
                calls.push(['make', this.api?.address])
            },
            destroy() {
                calls.push(['destroy', this.api?.address])
            },
        },
        // Puts a provider up through its handle and then throws, so a test can
        // see what a load that never finished hands back.
        FailingTool: {
            initialize() {
                this.api.provide('getSelection', () => 'a selection')
                throw new Error('initialize threw')
            },
            make() {},
            destroy() {},
        },
        PlainTool: { make: () => {}, destroy: () => {} },
    },
}))

const { toolModules } = await import('../../src/pre/tools')
const { mmgisAPI } = await import('../../src/essence/mmgisAPI/mmgisAPI')
const { generateToolMetadata } = await import(
    '../../src/essence/Basics/ToolController_/ToolMetadataUtils'
)
const { default: ToolControllerModern_ } = await import(
    '../../src/essence/Basics/ToolController_/ToolControllerModern_'
)

/**
 * A tool has two names and they are not interchangeable. `module` reaches its
 * class in the generated registry; `id` is its address — what it is called
 * everywhere else, including on the bus. These specs pin that the two stay in
 * their lanes, and that the controller hands each tool a handle minted under
 * its address and takes it back on the way out.
 */

const statsConfig = { name: 'Statistics', js: 'FetchStatsTool' }

function loadStatsTool() {
    const target = document.createElement('div')
    target.id = 'stats-target'
    document.body.appendChild(target)
    ToolControllerModern_.loadTool(generateToolMetadata(statsConfig), 'stats-target')
    return 'stats-target'
}

afterEach(() => {
    // loadedTools and the lifecycle registries are module-level singletons, so
    // a tool one test leaves loaded answers for the next test's. So are the
    // name -> address and binding -> address maps, which an empty config map
    // empties.
    ToolControllerModern_.destroyAllTools()
    ToolControllerModern_.buildToolConfigMap([])
    document.body.innerHTML = ''
    calls.length = 0
})

describe('resolving a tool config to its two names', () => {
    test('metadata carries the address beside the binding', () => {
        expect(generateToolMetadata(statsConfig)).toMatchObject({
            id: 'fetchstats',
            module: 'FetchStatsTool',
        })
        // A binding the generated registry does not carry derives the same way
        // the build would have derived it.
        expect(generateToolMetadata({ name: 'Plain', js: 'PlainTool' })).toMatchObject({
            id: 'plain',
            module: 'PlainTool',
        })
    })

    // A panel's `panelTools` names its tools however the config author wrote
    // them: the display name, the address, or the registry binding.
    test('a panel finds a tool by name, by address, or by module binding', () => {
        const { getToolData } = ToolControllerModern_.buildToolConfigMap([statsConfig])

        expect(getToolData('Statistics').metadata.id).toBe('fetchstats')
        expect(getToolData('fetchstats').metadata.id).toBe('fetchstats')
        expect(getToolData('FetchStatsTool').metadata.id).toBe('fetchstats')
        expect(getToolData('Nothing Named This')).toBe(undefined)
    })
})

describe('a tool the controller loads', () => {
    test('already holds its bus handle when its own code first runs', () => {
        loadStatsTool()

        // Both lifecycle hooks saw a handle, minted under the tool's address
        // rather than the binding that reached its class.
        expect(calls).toEqual([
            ['initialize', 'fetchstats'],
            ['make', 'fetchstats'],
        ])
    })

    test('has its handle taken back when its own load throws part-way', () => {
        const target = document.createElement('div')
        target.id = 'failing-target'
        document.body.appendChild(target)

        const loaded = ToolControllerModern_.loadTool(
            generateToolMetadata({ name: 'Failing', js: 'FailingTool' }),
            'failing-target'
        )

        // No destroyTool will ever come for an instance that never finished
        // loading, so the failed load itself is what hands the handle back.
        expect(loaded).toBe(null)
        expect(mmgisAPI.hasHandler('plugin:failing:getSelection')).toBe(false)
        expect(toolModules.FailingTool.api).toBe(null)
    })

    test('has the providers it put up through that handle answering', async () => {
        loadStatsTool()

        expect(mmgisAPI.hasHandler('plugin:fetchstats:getSelection')).toBe(true)
        expect(await mmgisAPI.request('plugin:fetchstats:getSelection')).toBe(
            'a selection'
        )
    })
})

describe('a tool the controller destroys', () => {
    test('is announced by its address, and its registrations handed back', () => {
        const targetId = loadStatsTool()
        const seen = []
        const off = mmgisAPI.on('plugins:destroyed', (payload) => seen.push(payload))

        try {
            ToolControllerModern_.destroyTool(targetId)
        } finally {
            off()
        }

        expect(seen).toEqual([{ pluginId: 'fetchstats' }])
        // The tool's own destroy() ran while it still had the handle; the
        // release comes after, so nothing it wanted to say was cut off.
        expect(calls).toContainEqual(['destroy', 'fetchstats'])
        expect(mmgisAPI.hasHandler('plugin:fetchstats:getSelection')).toBe(false)
        expect(toolModules.FetchStatsTool.api).toBe(null)
    })

    test('is named in the collective signal a full teardown ends with', () => {
        loadStatsTool()
        const seen = []
        const off = mmgisAPI.on('plugins:allDestroyed', (payload) => seen.push(payload))

        try {
            ToolControllerModern_.destroyAllTools()
        } finally {
            off()
        }

        expect(seen).toEqual([{ pluginIds: ['fetchstats'] }])
    })
})
