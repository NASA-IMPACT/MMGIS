import { test, expect, vi, beforeEach, afterEach } from 'vitest'

import F_ from '../../src/essence/Basics/Formulae_/Formulae_'
import {
    metersPerPixelAt,
    captureScreenshotWithScale,
    DEFAULT_SCALE_INSET_PX,
    MAX_SCALE_PITCH_DEG,
    MAX_SCALE_SPREAD,
} from '../../src/essence/Basics/MapEngines/mapScale'

// The map scale is measured on screen: the engine places two nearby container
// points on the ground and their distance is taken on the mission's planet.
// The stub engine is a plate carrée of `DEG_PER_PX` degrees per pixel with the
// equator on container row 0, inside a container laid out at (100, 50).

const EARTH_RADIUS = 6378137
const DEG_PER_PX = 0.001
const RECT = { left: 100, top: 50, width: 800, height: 600 }

const degToMeters = (deg) => (deg * Math.PI * EARTH_RADIUS) / 180

function makeEngine({
    rect = RECT,
    clientWidth = rect.width,
    pitch = 0,
    webMercator = true,
    toLatLng,
} = {}) {
    const container = {
        clientWidth,
        getBoundingClientRect: () => rect,
    }
    return {
        getContainer: () => container,
        getViewState: () => ({ pitch }),
        isWebMercator: () => webMercator,
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

// Leaflet's Web Mercator: 256 px per world at zoom 0, centred on 0°, 0°.
const mercator = (zoom, extra = {}) => {
    const world = 256 * 2 ** zoom
    return makeEngine({
        ...extra,
        toLatLng: ({ x, y }) => {
            const my = 0.5 - (y - RECT.height / 2) / world
            return {
                lng: ((x - RECT.width / 2) / world) * 360,
                lat: (Math.atan(Math.sinh(Math.PI * 2 * (my - 0.5))) * 180) / Math.PI,
            }
        },
    })
}

test.describe('metersPerPixelAt', () => {
    test('measures at the map centre when given no point', () => {
        const engine = makeEngine()
        metersPerPixelAt(engine)
        expect(engine.containerPointToLatLng).toHaveBeenNthCalledWith(1, {
            x: RECT.width / 2,
            y: RECT.height / 2,
        })
    })

    test('measures at a container point', () => {
        const engine = makeEngine()
        metersPerPixelAt(engine, { x: 30, y: 0 })
        expect(engine.containerPointToLatLng).toHaveBeenNthCalledWith(1, { x: 30, y: 0 })
    })

    test('gives the ground metres one pixel spans there', () => {
        // Row 0 is the equator, where the plate carrée is true to scale.
        expect(metersPerPixelAt(makeEngine(), { x: 0, y: 0 })).toBeCloseTo(
            degToMeters(DEG_PER_PX),
            6
        )
    })

    // At 60° a degree of longitude is half as long as at the equator.
    test('follows the latitude of the point measured', () => {
        const engine = makeEngine({
            toLatLng: ({ x, y }) => ({ lng: x * DEG_PER_PX, lat: y < 300 ? 0 : 60 }),
        })
        const equator = metersPerPixelAt(engine, { x: 0, y: 0 })
        const sixty = metersPerPixelAt(engine, { x: 0, y: 400 })
        expect(sixty / equator).toBeCloseTo(0.5, 6)
    })

    test("uses the mission's planet radius", () => {
        const engine = makeEngine()
        const earth = metersPerPixelAt(engine)
        F_.radiusOfPlanetMajor = 3396190
        expect(metersPerPixelAt(engine) / earth).toBeCloseTo(3396190 / EARTH_RADIUS, 9)
    })

    test('ignores a point that is not finite', () => {
        const engine = makeEngine()
        metersPerPixelAt(engine, { x: 'left' })
        expect(engine.containerPointToLatLng).toHaveBeenNthCalledWith(1, {
            x: RECT.width / 2,
            y: RECT.height / 2,
        })
    })

    // The scale is local to the point, so it holds wherever a single bar
    // could not describe the whole view.
    test('measures at any zoom and on a tilted map', () => {
        expect(metersPerPixelAt(mercator(0))).toBeCloseTo(
            (2 * Math.PI * EARTH_RADIUS) / 256,
            0
        )
        expect(metersPerPixelAt(makeEngine({ pitch: 60 }))).not.toBeNull()
    })

    // Zoomed out, rows above and below the world unproject toward the poles.
    test("is null for a point past a Mercator world's edge", () => {
        expect(metersPerPixelAt(mercator(0), { x: 400, y: 5 })).toBeNull()
        expect(metersPerPixelAt(mercator(0), { x: 400, y: 595 })).toBeNull()
    })

    // A polar projection has ground all the way to the pole.
    test('measures near the pole on a projection other than Mercator', () => {
        const engine = makeEngine({
            webMercator: false,
            toLatLng: ({ x }) => ({ lng: x * DEG_PER_PX, lat: 89 }),
        })
        expect(metersPerPixelAt(engine)).not.toBeNull()
    })

    test('is null for a point outside the map', () => {
        expect(metersPerPixelAt(makeEngine(), { x: -1, y: 10 })).toBeNull()
        expect(metersPerPixelAt(makeEngine(), { x: 10, y: RECT.height + 1 })).toBeNull()
    })

    test('is null for a map with no size', () => {
        const engine = makeEngine({ rect: { left: 0, top: 0, width: 0, height: 0 } })
        expect(metersPerPixelAt(engine)).toBeNull()
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
    const corner = { x: DEFAULT_SCALE_INSET_PX, y: RECT.height - DEFAULT_SCALE_INSET_PX }
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
        const cssScale = metersPerPixelAt(engine, corner)
        engine.captureScreenshot = () => Promise.resolve(shot(1600))
        const result = await captureScreenshotWithScale(engine)
        expect(result.width).toBe(1600)
        expect(result.metersPerPixel).toBeCloseTo(cssScale / 2, 9)
    })

    test('reads the scale of the view the capture began with', async () => {
        const engine = makeEngine()
        const before = metersPerPixelAt(engine, corner)
        engine.captureScreenshot = () => {
            engine.containerPointToLatLng.mockImplementation(({ x, y }) => ({
                lng: x * DEG_PER_PX * 4,
                lat: -y * DEG_PER_PX,
            }))
            return Promise.resolve(shot(800))
        }
        expect((await captureScreenshotWithScale(engine)).metersPerPixel).toBeCloseTo(before, 9)
    })

    // An export draws its bar where the on-screen one sits, so it measures
    // there and learns that spot in image pixels.
    test('measures at a requested page position and gives it in image pixels', async () => {
        const engine = makeEngine()
        const at = { clientX: 130, clientY: 450 }
        const cssScale = metersPerPixelAt(engine, { x: 30, y: 400 })
        engine.captureScreenshot = () => Promise.resolve(shot(1600))
        const result = await captureScreenshotWithScale(engine, at)
        expect(result.metersPerPixel).toBeCloseTo(cssScale / 2, 9)
        expect(result.scaleAnchor).toEqual({ x: 60, y: 800 })
    })

    test('gives no anchor without a requested position', async () => {
        const engine = makeEngine()
        engine.captureScreenshot = () => Promise.resolve(shot(1600))
        expect((await captureScreenshotWithScale(engine)).scaleAnchor).toBeUndefined()
    })

    test('stamps no scale when the map cannot measure one', async () => {
        const engine = makeEngine({ rect: { left: 0, top: 0, width: 0, height: 0 } })
        engine.captureScreenshot = () => Promise.resolve(shot(800))
        expect((await captureScreenshotWithScale(engine)).metersPerPixel).toBeNull()
    })

    // An export's bar must describe the whole image, so it has the view rules
    // the live bar does without.
    const exportScale = async (engine, at) => {
        engine.captureScreenshot = () => Promise.resolve(shot(RECT.width))
        return (await captureScreenshotWithScale(engine, at)).metersPerPixel
    }

    test("measures near the image's bottom-left corner when given no point", async () => {
        const engine = makeEngine()
        await exportScale(engine)
        expect(engine.containerPointToLatLng).toHaveBeenNthCalledWith(1, corner)
    })

    // A tilted map's scale changes from bottom to top, so no bar fits it.
    test('stamps no scale for a map tilted past the limit', async () => {
        expect(await exportScale(makeEngine({ pitch: MAX_SCALE_PITCH_DEG }))).not.toBeNull()
        expect(await exportScale(makeEngine({ pitch: MAX_SCALE_PITCH_DEG + 1 }))).toBeNull()
    })

    // A wide view spans latitudes whose scales differ several-fold, so a bar
    // sized for one of them misdescribes the rest.
    test('stamps no scale when it varies too much from top to bottom', async () => {
        // The view's rows run from 0° at the top to `bottomLat` at the bottom.
        const view = (bottomLat) =>
            makeEngine({
                toLatLng: ({ x, y }) => ({
                    lng: x * DEG_PER_PX,
                    lat: (-bottomLat * y) / RECT.height,
                }),
            })
        const spreadTo = (lat) => 1 / Math.cos((lat * Math.PI) / 180)
        expect(spreadTo(45)).toBeLessThan(MAX_SCALE_SPREAD)
        expect(spreadTo(60)).toBeGreaterThan(MAX_SCALE_SPREAD)
        expect(await exportScale(view(45))).not.toBeNull()
        expect(await exportScale(view(60))).toBeNull()
    })

    test('judges the spread only from rows the engine can place', async () => {
        const engine = makeEngine({
            toLatLng: ({ x, y }) =>
                y < 100 ? { lat: NaN, lng: NaN } : { lng: x * DEG_PER_PX, lat: 0 },
        })
        expect(await exportScale(engine)).toBeCloseTo(degToMeters(DEG_PER_PX), 6)
    })

    // Zooming out only widens the view, so once the scale is gone it stays
    // gone, including at world views where rows run past the world's edges.
    test('stays without a scale as a Mercator map zooms out past the limit', async () => {
        const shown = []
        for (const zoom of [0, 1, 2, 3, 4, 5, 6, 8, 10]) {
            shown.push((await exportScale(mercator(zoom))) != null)
        }
        const firstShown = shown.indexOf(true)
        expect(firstShown).toBeGreaterThan(0)
        expect(shown.slice(firstShown).every(Boolean)).toBe(true)
    })

    test("turns an engine's synchronous throw into a rejection", async () => {
        const engine = makeEngine()
        engine.captureScreenshot = () => {
            throw new Error('boom before promise')
        }
        await expect(captureScreenshotWithScale(engine)).rejects.toThrow(/boom/)
    })
})
