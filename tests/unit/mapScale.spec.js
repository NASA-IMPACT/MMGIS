import { test, expect, vi, beforeEach, afterEach } from 'vitest'

import F_ from '../../src/essence/Basics/Formulae_/Formulae_'
import {
    metersPerPixelAt,
    captureScreenshotWithScale,
    DEFAULT_SCALE_INSET_PX,
    MAX_SCALE_PITCH_DEG,
} from '../../src/essence/Basics/MapEngines/mapScale'

// The map scale is measured on screen: the engine places two nearby container
// points on the ground and their distance is taken on the mission's planet.
// The stub engine is a plate carrée of `DEG_PER_PX` degrees per pixel with the
// equator on container row 0, inside a container laid out at (100, 50).

const EARTH_RADIUS = 6378137
const DEG_PER_PX = 0.001
const RECT = { left: 100, top: 50, width: 800, height: 600 }

const degToMeters = (deg) => (deg * Math.PI * EARTH_RADIUS) / 180

function makeEngine({ rect = RECT, clientWidth = rect.width, pitch = 0, toLatLng } = {}) {
    const container = {
        clientWidth,
        getBoundingClientRect: () => rect,
    }
    return {
        getContainer: () => container,
        getViewState: () => ({ pitch }),
        containerPointToLatLng: vi.fn(
            toLatLng ?? (({ x, y }) => ({ lng: x * DEG_PER_PX, lat: -y * DEG_PER_PX }))
        ),
    }
}

let savedRadius
beforeEach(() => {
    savedRadius = F_.radiusOfPlanetMajor
    F_.radiusOfPlanetMajor = EARTH_RADIUS
})
afterEach(() => {
    F_.radiusOfPlanetMajor = savedRadius
})

test.describe('metersPerPixelAt', () => {
    test('measures near the bottom-left corner when given no point', () => {
        const engine = makeEngine()
        metersPerPixelAt(engine)
        expect(engine.containerPointToLatLng).toHaveBeenNthCalledWith(1, {
            x: DEFAULT_SCALE_INSET_PX,
            y: RECT.height - DEFAULT_SCALE_INSET_PX,
        })
    })

    test('takes a page position relative to the map container', () => {
        const engine = makeEngine()
        metersPerPixelAt(engine, { clientX: 130, clientY: 50 })
        expect(engine.containerPointToLatLng).toHaveBeenNthCalledWith(1, { x: 30, y: 0 })
    })

    test('gives the ground metres one pixel spans there', () => {
        const engine = makeEngine()
        // Row 0 is the equator, where the plate carrée is true to scale.
        expect(metersPerPixelAt(engine, { clientX: 100, clientY: 50 })).toBeCloseTo(
            degToMeters(DEG_PER_PX),
            6
        )
    })

    // At 60° a degree of longitude is half as long as at the equator, so a
    // bar measured at the centre would be wrong at the bottom of the map.
    test('follows the latitude of the point measured', () => {
        const engine = makeEngine({
            toLatLng: ({ x, y }) => ({ lng: x * DEG_PER_PX, lat: y === 0 ? 0 : 60 }),
        })
        const equator = metersPerPixelAt(engine, { clientX: 100, clientY: 50 })
        const sixty = metersPerPixelAt(engine, { clientX: 100, clientY: 60 })
        expect(sixty / equator).toBeCloseTo(0.5, 6)
    })

    test("uses the mission's planet radius", () => {
        const engine = makeEngine()
        const at = { clientX: 100, clientY: 50 }
        const earth = metersPerPixelAt(engine, at)
        F_.radiusOfPlanetMajor = 3396190
        expect(metersPerPixelAt(engine, at) / earth).toBeCloseTo(3396190 / EARTH_RADIUS, 9)
    })

    test('ignores a position that is not a finite point', () => {
        const engine = makeEngine()
        metersPerPixelAt(engine, { clientX: 'left' })
        expect(engine.containerPointToLatLng).toHaveBeenNthCalledWith(1, {
            x: DEFAULT_SCALE_INSET_PX,
            y: RECT.height - DEFAULT_SCALE_INSET_PX,
        })
    })

    test('is null for a map with no size', () => {
        const engine = makeEngine({ rect: { left: 0, top: 0, width: 0, height: 0 } })
        expect(metersPerPixelAt(engine)).toBeNull()
    })

    // A tilted map's scale changes from bottom to top, so no bar fits it.
    test('is null for a map tilted past the limit', () => {
        expect(metersPerPixelAt(makeEngine({ pitch: MAX_SCALE_PITCH_DEG }))).not.toBeNull()
        expect(metersPerPixelAt(makeEngine({ pitch: MAX_SCALE_PITCH_DEG + 1 }))).toBeNull()
    })

    test('is null where the engine cannot place the points', () => {
        const engine = makeEngine({ toLatLng: () => ({ lat: NaN, lng: NaN }) })
        expect(metersPerPixelAt(engine)).toBeNull()
    })

    test('is null when the engine throws', () => {
        const engine = makeEngine({
            toLatLng: () => {
                throw new Error('no projection yet')
            },
        })
        expect(metersPerPixelAt(engine)).toBeNull()
    })

    test('is null when the planet radius is not configured', () => {
        F_.radiusOfPlanetMajor = NaN
        expect(metersPerPixelAt(makeEngine())).toBeNull()
    })
})

test.describe('captureScreenshotWithScale', () => {
    const shot = (width) => ({
        blob: new Blob(['png'], { type: 'image/png' }),
        mimeType: 'image/png',
        extension: 'png',
        width,
        height: width / 2,
    })

    // The image is twice the map's CSS width (devicePixelRatio 2), so each
    // image pixel spans half the ground a CSS pixel does.
    test('stamps the scale in image pixels', async () => {
        const engine = makeEngine()
        const cssScale = metersPerPixelAt(engine)
        engine.captureScreenshot = () => Promise.resolve(shot(1600))
        const result = await captureScreenshotWithScale(engine)
        expect(result.width).toBe(1600)
        expect(result.metersPerPixel).toBeCloseTo(cssScale / 2, 9)
    })

    test('reads the scale of the view the capture began with', async () => {
        const engine = makeEngine()
        const before = metersPerPixelAt(engine)
        engine.captureScreenshot = () => {
            engine.containerPointToLatLng.mockImplementation(({ x, y }) => ({
                lng: x * DEG_PER_PX * 4,
                lat: -y * DEG_PER_PX,
            }))
            return Promise.resolve(shot(800))
        }
        expect((await captureScreenshotWithScale(engine)).metersPerPixel).toBeCloseTo(before, 9)
    })

    test('stamps no scale when the map cannot measure one', async () => {
        const engine = makeEngine({ rect: { left: 0, top: 0, width: 0, height: 0 } })
        engine.captureScreenshot = () => Promise.resolve(shot(800))
        expect((await captureScreenshotWithScale(engine)).metersPerPixel).toBeNull()
    })

    test("turns an engine's synchronous throw into a rejection", async () => {
        const engine = makeEngine()
        engine.captureScreenshot = () => {
            throw new Error('boom before promise')
        }
        await expect(captureScreenshotWithScale(engine)).rejects.toThrow(/boom/)
    })
})
