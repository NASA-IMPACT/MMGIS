import { describe, test, expect } from 'vitest'

// Tests for the boot-time demo-mission convergence helper.

const {
    DEMO_MISSION_LOCK_KEY,
    deepEqual,
    resolveBlueprint,
    convergeDemoMission,
} = require('../../scripts/demo-mission-converge.js')

const BLUEPRINT_TEXT = JSON.stringify({
    msv: {
        mission: 'Demo Dashboard',
        basemap: {
            provider: 'mapbox',
            accessToken: '{{MAPBOX_TOKEN}}',
        },
    },
    layers: [{ uuid: 'a1b2c3', name: 'Layer A' }],
})

const TOKEN = 'pk.test-token'

// The blueprint as convergeDemoMission should resolve it, with the placeholder
// substituted. Key order is deliberately different from BLUEPRINT_TEXT so the
// "unchanged" case exercises key-order insensitivity.
function resolvedBlueprintReordered() {
    return {
        layers: [{ name: 'Layer A', uuid: 'a1b2c3' }],
        msv: {
            basemap: {
                accessToken: TOKEN,
                provider: 'mapbox',
            },
            mission: 'Demo Dashboard',
        },
    }
}

// Builds injectable deps plus the recording surfaces the tests assert on.
function makeHarness(options = {}) {
    const logs = []
    const created = []
    const createOptions = []
    const findOneCalls = []
    const queryCalls = []
    const calls = { loadModel: 0 }
    const tx = { fake: 'transaction' }

    const Config = {
        sync: async () => {},
        findOne: async (query) => {
            findOneCalls.push(query)
            return options.row === undefined ? null : options.row
        },
        create: async (values, createOpts) => {
            created.push(values)
            createOptions.push(createOpts)
            if (options.createRejects) throw new Error('insert failed')
            return values
        },
    }

    const sequelize = {
        transaction: async (fn) => fn(tx),
        query: async (sql, queryOpts) => {
            queryCalls.push({ sql, queryOpts })
            return {
                locked: options.locked === undefined ? true : options.locked,
            }
        },
    }

    const deps = {
        env: {
            OVERWRITE_DEMO_MISSION: 'true',
            MAPBOX_TOKEN: TOKEN,
            ...(options.env || {}),
        },
        logger: (level, message, caller) => logs.push({ level, message, caller }),
        readFile: () => options.blueprintText || BLUEPRINT_TEXT,
        blueprintPath: '/fake/full-demo-mission.json',
        loadModel: () => {
            calls.loadModel++
            return { Config, sequelize }
        },
    }

    return { deps, logs, created, createOptions, findOneCalls, queryCalls, calls, tx }
}

describe('convergeDemoMission', () => {
    test('does nothing at all unless the flag is exactly "true"', async () => {
        for (const value of [undefined, '', 'false', 'TRUE', '1']) {
            const h = makeHarness({ env: { OVERWRITE_DEMO_MISSION: value } })
            const result = await convergeDemoMission(h.deps)
            expect(result).toEqual({ outcome: 'disabled' })
            expect(h.calls.loadModel).toBe(0)
            expect(h.logs).toEqual([])
            expect(h.created).toEqual([])
        }
    })

    test('creates the mission at version 0 when it does not exist', async () => {
        const h = makeHarness({ row: null })
        const result = await convergeDemoMission(h.deps)

        expect(result).toEqual({ outcome: 'created' })
        expect(h.created).toHaveLength(1)
        expect(h.created[0].mission).toBe('Demo Dashboard')
        expect(h.created[0].version).toBe(0)
        expect(h.created[0].config.msv.basemap.accessToken).toBe(TOKEN)
        expect(JSON.stringify(h.created[0].config)).not.toContain(
            '{{MAPBOX_TOKEN}}'
        )
        // Only the blueprint's own mission is ever queried.
        expect(h.findOneCalls[0].where).toEqual({ mission: 'Demo Dashboard' })
    })

    test('pins the lock, the read and the write to one transaction', async () => {
        const h = makeHarness({ row: null })
        await convergeDemoMission(h.deps)

        // Advisory locks are connection-scoped: the lock query and every
        // subsequent statement must share the transaction (= connection), and
        // the lock must be the transaction-scoped variant with the fixed key.
        expect(h.queryCalls).toHaveLength(1)
        expect(h.queryCalls[0].sql).toContain(
            `pg_try_advisory_xact_lock(${DEMO_MISSION_LOCK_KEY})`
        )
        expect(h.queryCalls[0].queryOpts.transaction).toBe(h.tx)
        expect(h.findOneCalls[0].transaction).toBe(h.tx)
        expect(h.createOptions[0].transaction).toBe(h.tx)
    })

    test('writes nothing when the latest version already matches', async () => {
        const h = makeHarness({
            row: { version: 7, config: resolvedBlueprintReordered() },
        })
        const result = await convergeDemoMission(h.deps)

        expect(result).toEqual({ outcome: 'unchanged' })
        expect(h.created).toEqual([])
    })

    test('appends one new version when the saved config differs', async () => {
        const config = resolvedBlueprintReordered()
        config.msv.mission = 'Demo Dashboard'
        config.layers[0].name = 'Hand-edited Layer'

        const h = makeHarness({ row: { version: 4, config } })
        const result = await convergeDemoMission(h.deps)

        expect(result).toEqual({ outcome: 'appended' })
        expect(h.created).toHaveLength(1)
        expect(h.created[0].version).toBe(5)
        expect(h.created[0].mission).toBe('Demo Dashboard')
        expect(h.created[0].config.layers[0].name).toBe('Layer A')
    })

    test('skips entirely when another instance holds the lock', async () => {
        const h = makeHarness({ locked: false })
        const result = await convergeDemoMission(h.deps)

        expect(result).toEqual({ outcome: 'lock_held' })
        expect(h.findOneCalls).toEqual([])
        expect(h.created).toEqual([])
        expect(h.logs).toHaveLength(1)
        expect(h.logs[0].level).toBe('info')
    })

    test('refuses to write when MAPBOX_TOKEN is missing', async () => {
        for (const token of [undefined, '']) {
            const h = makeHarness({ env: { MAPBOX_TOKEN: token } })
            const result = await convergeDemoMission(h.deps)

            expect(result.outcome).toBe('error')
            expect(h.calls.loadModel).toBe(0)
            expect(h.created).toEqual([])
            expect(h.logs).toHaveLength(1)
            expect(h.logs[0].level).toBe('error')
            expect(h.logs[0].caller).toBe('demo_convergence_error')
            expect(h.logs[0].message).toContain('MAPBOX_TOKEN')
        }
    })

    test('resolves rather than rejects when the database write fails', async () => {
        const h = makeHarness({ row: null, createRejects: true })
        const result = await convergeDemoMission(h.deps)

        expect(result.outcome).toBe('error')
        expect(result.error.message).toBe('insert failed')
        expect(h.logs).toHaveLength(1)
        expect(h.logs[0].level).toBe('error')
        expect(h.logs[0].caller).toBe('demo_convergence_error')
    })

    test('resolves rather than rejects when the blueprint is unparseable', async () => {
        const h = makeHarness({ blueprintText: '{ not json' })
        const result = await convergeDemoMission(h.deps)

        expect(result.outcome).toBe('error')
        expect(h.calls.loadModel).toBe(0)
        expect(h.logs).toHaveLength(1)
        expect(h.logs[0].caller).toBe('demo_convergence_error')
    })
})

describe('resolveBlueprint', () => {
    test('substitutes every placeholder occurrence', () => {
        const parsed = resolveBlueprint({
            env: { MAPBOX_TOKEN: TOKEN },
            readFile: () =>
                '{"a":"{{MAPBOX_TOKEN}}","b":"x{{MAPBOX_TOKEN}}y"}',
            blueprintPath: '/fake/full-demo-mission.json',
        })
        expect(parsed).toEqual({ a: TOKEN, b: `x${TOKEN}y` })
    })

    test('is immune to replacement-pattern characters in the token', () => {
        // String.replace would expand "$&" to the matched placeholder text;
        // resolveBlueprint must write the token through verbatim.
        const parsed = resolveBlueprint({
            env: { MAPBOX_TOKEN: 'pk.$&$`$\'weird' },
            readFile: () => '{"a":"{{MAPBOX_TOKEN}}"}',
            blueprintPath: '/fake/full-demo-mission.json',
        })
        expect(parsed.a).toBe('pk.$&$`$\'weird')
    })

    test('throws when the placeholder is present but the token is not', () => {
        expect(() =>
            resolveBlueprint({
                env: {},
                readFile: () => '{"a":"{{MAPBOX_TOKEN}}"}',
                blueprintPath: '/fake/full-demo-mission.json',
            })
        ).toThrow('MAPBOX_TOKEN')
    })

    test('tolerates a blueprint with no placeholder and no token', () => {
        const parsed = resolveBlueprint({
            env: {},
            readFile: () => '{"a":1}',
            blueprintPath: '/fake/full-demo-mission.json',
        })
        expect(parsed).toEqual({ a: 1 })
    })
})

describe('deepEqual', () => {
    test('ignores object key order', () => {
        expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true)
    })

    test('recurses into nested objects', () => {
        expect(
            deepEqual({ a: { b: { c: 1 }, d: 2 } }, { a: { d: 2, b: { c: 1 } } })
        ).toBe(true)
        expect(deepEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false)
    })

    test('respects array order and length', () => {
        expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true)
        expect(deepEqual([1, 2, 3], [3, 2, 1])).toBe(false)
        expect(deepEqual([1, 2], [1, 2, 3])).toBe(false)
        expect(deepEqual([{ a: 1 }], [{ a: 1 }])).toBe(true)
    })

    test('does not conflate arrays with objects', () => {
        expect(deepEqual([], {})).toBe(false)
        expect(deepEqual({ 0: 'a' }, ['a'])).toBe(false)
    })

    test('is strict about primitives', () => {
        expect(deepEqual(1, '1')).toBe(false)
        expect(deepEqual(true, 1)).toBe(false)
        expect(deepEqual('a', 'a')).toBe(true)
        expect(deepEqual(0, -0)).toBe(true)
    })

    test('distinguishes null from objects and from undefined', () => {
        expect(deepEqual(null, null)).toBe(true)
        expect(deepEqual(null, {})).toBe(false)
        expect(deepEqual({}, null)).toBe(false)
        expect(deepEqual(null, undefined)).toBe(false)
    })

    test('treats a missing key as different from an undefined value', () => {
        expect(deepEqual({ a: undefined }, {})).toBe(false)
        expect(deepEqual({ a: undefined }, { b: undefined })).toBe(false)
    })
})
