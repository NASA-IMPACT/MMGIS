import { describe, it, expect, vi } from 'vitest'
import { mergePatch, editConfig, findLayerIndex } from '../src/configEdit.js'

describe('mergePatch (RFC 7386)', () => {
    it.each([
        ['nested objects merge', { a: { b: 1, c: 2 } }, { a: { c: 3 } }, { a: { b: 1, c: 3 } }],
        ['null deletes a key', { a: 1, b: 2 }, { b: null }, { a: 1 }],
        ['arrays replace wholesale', { a: [1, 2] }, { a: [3] }, { a: [3] }],
        ['scalars replace', { a: 1 }, { a: 'x' }, { a: 'x' }],
        ['non-object patch replaces target', { a: 1 }, 'str', 'str'],
        ['new nested keys are created', { a: {} }, { a: { b: { c: 1 } } }, { a: { b: { c: 1 } } }],
        ['null inside new object is dropped', {}, { a: { b: null } }, { a: {} }],
    ])('%s', (_name, target, patch, expected) => {
        expect(mergePatch(target, patch)).toEqual(expected)
    })
    it('does not mutate the target', () => {
        const target = { a: { b: 1 } }
        mergePatch(target, { a: { b: 2 } })
        expect(target.a.b).toBe(1)
    })
})

describe('editConfig', () => {
    function fakeClient(config: any) {
        return {
            getMission: vi.fn(async () => ({ mission: 'M', config, version: 3 })),
            upsertMission: vi.fn(async () => ({ mission: 'M', version: 4 })),
        } as any
    }
    it('fetches, mutates a clone, and upserts with forceClientUpdate and default info', async () => {
        const original = { look: { pagename: 'Old' }, layers: [] }
        const client = fakeClient(original)
        const out = await editConfig(client, 'M', (config) => {
            config.look.pagename = 'New'
        })
        expect(out.version).toBe(4)
        expect(original.look.pagename).toBe('Old')
        const [mission, sent, opts] = client.upsertMission.mock.calls[0]
        expect(mission).toBe('M')
        expect(sent.look.pagename).toBe('New')
        expect(opts).toEqual({ forceClientUpdate: true, info: { type: 'upsert' } })
    })
    it('uses the info returned by the mutator', async () => {
        const client = fakeClient({ layers: [] })
        await editConfig(client, 'M', (config) => {
            config.layers.push({ name: 'L' })
            return { info: { type: 'addLayer', layerName: 'L' } }
        })
        expect(client.upsertMission.mock.calls[0][2]).toEqual({
            forceClientUpdate: true, info: { type: 'addLayer', layerName: 'L' },
        })
    })
})

describe('findLayerIndex', () => {
    const config = { layers: [{ name: 'A', uuid: 'u1' }, { name: 'B', uuid: 'u2' }] }
    it('finds by name and by uuid', () => {
        expect(findLayerIndex(config, 'B')).toBe(1)
        expect(findLayerIndex(config, 'u1')).toBe(0)
    })
    it('returns -1 for unknown and missing layers array', () => {
        expect(findLayerIndex(config, 'nope')).toBe(-1)
        expect(findLayerIndex({}, 'A')).toBe(-1)
    })
})
