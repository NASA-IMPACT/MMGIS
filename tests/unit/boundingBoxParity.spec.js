import { describe, test, expect, beforeEach, afterAll, vi } from 'vitest'
import { validateLayer } from '../../configure/src/core/validators'

vi.mock('../../src/essence/Basics/Map_/Map_', () => ({ default: {} }))

const { default: L_ } = await import(
    '../../src/essence/Basics/Layers_/Layers_.js'
)

/**
 * A bounding box is checked twice: Configure flags it on the layer form, and
 * the runtime decides whether "Zoom to layer" can use it. Configure is its own
 * build and never imports from src/, so the two checks are copies. This holds
 * them together: a box Configure accepts is one the runtime zooms to, and a box
 * Configure flags is one the runtime ignores.
 */

const LAYER = 'Outline_0123456789abcdef'

describe('bounding box: Configure and runtime agree', () => {
    let providers

    afterAll(() => {
        delete window.mmgisAPI
        L_.layers.data = {}
    })

    beforeEach(() => {
        L_.layers.data = {}
        L_.layers.layer = {}
        L_.layers.nameToUUID = {}
        providers = {}
        window.mmgisAPI = {
            provide: (name, fn) => {
                providers[name] = fn
                return () => {}
            },
        }
        L_.fina(null, null, null, null, null, null)
    })

    const configureAccepts = (boundingBox) =>
        validateLayer({ type: 'vector', name: 'Layer', url: 'x', boundingBox }).filter(
            (e) => e.field === 'boundingBox',
        ).length === 0

    const runtimeZoomsTo = (boundingBox) => {
        L_.layers.data = { [LAYER]: { type: 'vector', boundingBox } }
        return providers['layers:getBounds'](LAYER) !== null
    }

    test.each([
        ['numbers', [-125, 24, -66, 50]],
        ['strings', ['-125', '24', '-66', '50']],
        ['one comma-separated string', '-125,24,-66,50'],
        ['too short', [-125, 24, -66]],
        ['not a number', [-125, 'south', -66, 50]],
        ['a short comma-separated string', '-125,24,-66'],
        ['longitude past 180', [-190, 24, -66, 50]],
        ['latitude past 90', [-125, 24, -66, 95]],
        ['south above north', [-125, 50, -66, 24]],
        ['south equal to north', [-125, 24, -66, 24]],
        ['an empty string', ''],
        ['not an array', { west: -125 }],
    ])('%s', (_label, boundingBox) => {
        expect(runtimeZoomsTo(boundingBox)).toBe(configureAccepts(boundingBox))
    })
})
