import { test, expect, beforeEach, vi } from 'vitest'

// Layers_ reaches Map_ transitively (Description -> TimeControl -> Map_), and
// Map_ pulls in the JSX viewers that Vite will not parse from a .js file. The
// module under test never imports Map_ itself, so a bare stub keeps the
// import graph loadable (same technique as layersOpacity.spec.js).
vi.mock('../../src/essence/Basics/Map_/Map_', () => ({ default: {} }))

const { default: L_ } = await import(
    '../../src/essence/Basics/Layers_/Layers_.js'
)

/**
 * L_.getUrl's throughTileServer/COG branch climbs out of the mission path
 * ('../../' non-Docker, '/' Docker) to reach a server-backed tile endpoint.
 * A static (published) build has no such endpoint — its tiles live under
 * Missions/<mission>/... in the bucket — so the climb must not apply there.
 */
test.describe('L_.getUrl static-build guard', () => {
    beforeEach(() => {
        L_.missionPath = 'Missions/M/'
    })

    test('static: throughTileServer tile stays mission-relative, no climb', () => {
        window.mmgisglobal = { SERVER: 'static', IS_DOCKER: 'false' }
        const url = L_.getUrl('tile', 'tiles/{z}/{x}/{y}.png', {
            throughTileServer: true,
        })
        expect(url).toBe('Missions/M/tiles/{z}/{x}/{y}.png')
    })

    test('static: COG tile stays mission-relative, no climb', () => {
        window.mmgisglobal = { SERVER: 'static', IS_DOCKER: 'false' }
        const url = L_.getUrl('tile', 'COG:cogs/a.tif', {})
        expect(url).toBe('Missions/M/cogs/a.tif')
    })

    test('server, non-Docker: throughTileServer tile climbs (existing behavior)', () => {
        window.mmgisglobal = { SERVER: 'node', IS_DOCKER: 'false' }
        const url = L_.getUrl('tile', 'tiles/{z}/{x}/{y}.png', {
            throughTileServer: true,
        })
        expect(url).toBe('../../Missions/M/tiles/{z}/{x}/{y}.png')
    })

    test('server, Docker: throughTileServer tile roots to / (existing behavior)', () => {
        window.mmgisglobal = { SERVER: 'node', IS_DOCKER: 'true' }
        const url = L_.getUrl('tile', 'tiles/{z}/{x}/{y}.png', {
            throughTileServer: true,
        })
        expect(url).toBe('/Missions/M/tiles/{z}/{x}/{y}.png')
    })
})
