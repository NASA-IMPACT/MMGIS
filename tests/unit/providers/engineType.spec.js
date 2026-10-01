import { test, expect, beforeEach, afterEach, vi } from 'vitest'
vi.mock('../../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))
vi.mock('../../../src/pre/tools', () => ({ toolModules: {} }))

import { mmgisAPI } from '../../../src/essence/mmgisAPI/mmgisAPI'
import L_ from '../../../src/essence/Basics/Layers_/Layers_'

let realMap

beforeEach(() => {
    realMap = L_.Map_
})

afterEach(() => {
    L_.Map_ = realMap
})

test('reports the engine drawing the map, so a plugin can tell which it is', async () => {
    L_.Map_ = { engine: { engineType: 'deckgl' } }

    await expect(mmgisAPI.request('map:getEngineType')).resolves.toBe('deckgl')
})

test('answers null before an engine exists, rather than rejecting', async () => {
    L_.Map_ = {}

    await expect(mmgisAPI.request('map:getEngineType')).resolves.toBeNull()
})
