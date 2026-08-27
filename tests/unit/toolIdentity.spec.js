import { describe, test, expect, afterEach, vi } from 'vitest'

// Viewer_ pulls in Photosphere/ModelViewer/PDFViewer, which are JSX written in
// .js files that vite's import-analysis can't parse. Nothing here needs the
// real viewers, so stub the aggregator to keep the import chain parseable.
vi.mock('../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))

// The hermetic stub the rest of the unit suite aliases in carries an empty
// `toolIds`, which only ever exercises the derived half of the rule. This file
// is about the declared half, so it stands in a registry that carries both: an
// id a tool declared for itself, a second binding of that same tool sharing it,
// and a binding the map doesn't mention at all.
const { calls } = vi.hoisted(() => ({ calls: [] }))
vi.mock('../../src/pre/tools', () => ({
    toolIds: {
        FetchStatsTool: 'fetch-stats',
        FetchStatsTool_Legacy: 'fetch-stats',
        ThrowingReleaseTool: 'throwing-release',
    },
    toolModules: {
        // Records the id its injected handle carries at each lifecycle step, so
        // a test can see whether the handle was there before the tool ran.
        FetchStatsTool: {
            initialize() {
                calls.push(['initialize', this.api?.pluginId])
                this.api.provide('getSelection', () => 'a selection')
            },
            make() {
                calls.push(['make', this.api?.pluginId])
            },
            destroy() {
                calls.push(['destroy', this.api?.pluginId])
            },
        },
        PlainTool: { make: () => {}, destroy: () => {} },
        // Fails half-way through loading, after the controller has already
        // handed it a bus handle.
        ExplodingTool: {
            make() {
                throw new Error('boom')
            },
            destroy: () => {},
        },
        // Sabotages its own handle on the way out, standing in for any release
        // that fails once the controller is already committed to the teardown.
        ThrowingReleaseTool: {
            make: () => {},
            destroy() {
                this.api.release = () => {
                    throw new Error('release boom')
                }
            },
        },
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
const { default: UserInterfaceModern_ } = await import(
    '../../src/essence/Basics/UserInterface_/UserInterfaceModern_'
)

/**
 * A tool has two names and they are not interchangeable. `module` reaches its
 * class in the generated registry; `id` is what it is called everywhere else —
 * on the bus, in the controller's registries, in the DOM, in teardown events.
 * These specs pin that the two stay in their lanes, and that the controller
 * hands each tool a bus handle minted under its id and takes it back on the way
 * out.
 */

const statsConfig = { name: 'Fetch Stats', js: 'FetchStatsTool' }

function loadStatsTool() {
    const target = document.createElement('div')
    target.id = 'stats-target'
    document.body.appendChild(target)
    ToolControllerModern_.loadTool(generateToolMetadata(statsConfig), 'stats-target')
    return 'stats-target'
}

afterEach(() => {
    // loadedTools and the lifecycle registries are module-level singletons, so
    // a tool one test leaves loaded answers for the next test's.
    ToolControllerModern_.destroyAllTools()
    document.body.innerHTML = ''
    calls.length = 0
    vi.restoreAllMocks()
})

describe('resolving a tool config to its two names', () => {
    test('the id a tool declared wins over its module binding', () => {
        const metadata = generateToolMetadata(statsConfig)

        expect(metadata.id).toBe('fetch-stats')
        expect(metadata.module).toBe('FetchStatsTool')
    })

    test('a binding the registry does not carry falls back to derivation', () => {
        const metadata = generateToolMetadata({ name: 'Plain', js: 'PlainTool' })

        expect(metadata.id).toBe('plain')
        expect(metadata.module).toBe('PlainTool')
    })

    test('an entry with no module at all is named after itself', () => {
        const metadata = generateToolMetadata({ name: 'My Cool Tool' })

        expect(metadata.id).toBe('my-cool-tool')
    })

    // Both registries are plain objects at runtime, so a binding named after
    // something on Object.prototype would otherwise read an inherited member:
    // as an id it sanitizes to the empty string and takes the whole config map
    // down; as a module it is truthy, so the load would stamp a handle onto
    // the global Object constructor and enter a phantom into the registries
    // instead of reporting a module it cannot find.
    test('a binding named after a prototype member derives, and fails to load', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const metadata = generateToolMetadata({ name: 'Odd', js: 'constructor' })
        expect(metadata.id).toBe('constructor')

        const target = document.createElement('div')
        target.id = 'odd-target'
        document.body.appendChild(target)

        expect(ToolControllerModern_.loadTool(metadata, 'odd-target')).toBe(null)
        expect(ToolControllerModern_.getTool('odd-target')).toBe(null)
        expect(ToolControllerModern_.isPluginLoaded('constructor')).toBe(false)
        expect(Object.api).toBe(undefined)
    })

    // Two bindings of one tool legitimately share an id, so a mission config
    // listing both asks for one identity to name two entries. Skipping the
    // loser would drop it from the layout with only a console line to say why,
    // while the winner answered the bus under the name both were configured by.
    test('two entries claiming one id is a registration error naming both', () => {
        expect(() =>
            ToolControllerModern_.buildToolConfigMap([
                statsConfig,
                { name: 'Legacy Stats', js: 'FetchStatsTool_Legacy' },
            ])
        ).toThrow(/fetch-stats.*Fetch Stats.*Legacy Stats/)
    })
})

describe('a tool the controller loads', () => {
    test('is reached by its module but registered under its id', () => {
        loadStatsTool()

        expect(ToolControllerModern_.isPluginLoaded('fetch-stats')).toBe(true)
        expect(ToolControllerModern_.isPluginLoaded('FetchStatsTool')).toBe(false)
        expect(ToolControllerModern_.listPlugins()).toContainEqual({
            id: 'fetch-stats',
            state: 'visible',
        })
    })

    test('lands in the card the interface rendered for that id', () => {
        // The card and the load both come off the same metadata field, which is
        // the only reason a tool the controller loads meets the container the
        // interface built for it. Drive the real card builder rather than
        // restating the `${panelId}-tool-${id}` convention back at itself.
        const metadata = generateToolMetadata(statsConfig)
        const { toolCard, targetId, loadTool } =
            UserInterfaceModern_.createToolCard(metadata, 'left-panel')
        document.body.appendChild(toolCard[0])

        loadTool()

        expect(targetId).toBe('left-panel-tool-fetch-stats')
        expect(toolCard.attr('data-tool')).toBe('fetch-stats')
        expect(ToolControllerModern_.getTool(targetId).toolId).toBe('fetch-stats')
        expect(document.getElementById(targetId)).toBe(toolCard[0])
    })

    test('already holds its bus handle when its own code first runs', () => {
        loadStatsTool()

        // Both lifecycle hooks saw a handle, and it was minted under the tool's
        // id rather than the binding that reached its class.
        expect(calls).toEqual([
            ['initialize', 'fetch-stats'],
            ['make', 'fetch-stats'],
        ])
        expect(toolModules.FetchStatsTool.api.pluginId).toBe('fetch-stats')
    })

    test('has the providers it put up through the handle answering', () => {
        loadStatsTool()

        expect(mmgisAPI.hasHandler('plugin:fetch-stats:getSelection')).toBe(true)
        expect(mmgisAPI.hasHandler('plugin:fetch-stats:getVars')).toBe(true)
    })

    test('has its handle handed straight back when it throws mid-load', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const target = document.createElement('div')
        target.id = 'exploding-target'
        document.body.appendChild(target)

        expect(
            ToolControllerModern_.loadTool(
                generateToolMetadata({ name: 'Exploding', js: 'ExplodingTool' }),
                'exploding-target'
            )
        ).toBe(null)

        // A load that throws never tracks the instance, so no destroyTool will
        // come for it. The handle has to be released here or what it already
        // put on the bus answers for a tool that isn't there.
        await expect(
            mmgisAPI.request('plugin:exploding:getVars')
        ).rejects.toThrow(/No handler/)
        expect(toolModules.ExplodingTool.api).toBe(null)
        expect(ToolControllerModern_.isPluginLoaded('exploding')).toBe(false)
    })
})

describe('a tool the controller destroys', () => {
    test('is announced by the id it spoke to core services under', () => {
        const targetId = loadStatsTool()
        const seen = []
        const off = mmgisAPI.on('plugins:destroyed', (payload) => seen.push(payload))

        try {
            ToolControllerModern_.destroyTool(targetId)
        } finally {
            off()
        }

        expect(seen).toEqual([{ pluginId: 'fetch-stats' }])
    })

    test('has its registrations handed back, and its handle cleared', () => {
        const targetId = loadStatsTool()

        ToolControllerModern_.destroyTool(targetId)

        // The tool's own destroy() ran while it still had the handle; the
        // release comes after, so nothing it wanted to say was cut off.
        expect(calls).toContainEqual(['destroy', 'fetch-stats'])
        expect(mmgisAPI.hasHandler('plugin:fetch-stats:getSelection')).toBe(false)
        expect(mmgisAPI.hasHandler('plugin:fetch-stats:getVars')).toBe(false)
        expect(toolModules.FetchStatsTool.api).toBe(null)
    })

    test('is torn down and announced even when its release throws', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const target = document.createElement('div')
        target.id = 'throwing-target'
        document.body.appendChild(target)
        ToolControllerModern_.loadTool(
            generateToolMetadata({ name: 'Throwing', js: 'ThrowingReleaseTool' }),
            'throwing-target'
        )

        const seen = []
        const off = mmgisAPI.on('plugins:destroyed', (payload) => seen.push(payload))
        try {
            expect(() =>
                ToolControllerModern_.destroyTool('throwing-target')
            ).not.toThrow()
        } finally {
            off()
        }

        // A release that throws abandons the rest of its drain, so this
        // plugin's un-reached providers leak — they stay on the bus answering
        // for a tool that is gone. Containing that is the point: the leak does
        // not spread into the lifecycle registries, which are clear, and the
        // teardown still reached whoever was listening for it.
        expect(seen).toEqual([{ pluginId: 'throwing-release' }])
        expect(ToolControllerModern_.isPluginLoaded('throwing-release')).toBe(false)
        expect(ToolControllerModern_.getTool('throwing-target')).toBe(null)
    })

    test('gets a fresh handle on the next load', () => {
        ToolControllerModern_.destroyTool(loadStatsTool())
        loadStatsTool()

        expect(toolModules.FetchStatsTool.api.pluginId).toBe('fetch-stats')
        expect(mmgisAPI.hasHandler('plugin:fetch-stats:getSelection')).toBe(true)
    })
})
