import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import FeaturePopupTool from '../FeaturePopupTool'

const PIN_ID = 'feature-popup-pin'
const REMOVED = [['map:removeLayer', { id: PIN_ID }]]
const LAYER = 'lyr-opted-in'
const EXACT_LAYER = 'lyr-exact'

const polygon = {
    type: 'Feature',
    properties: { name: 'Site A' },
    geometry: {
        type: 'Polygon',
        coordinates: [
            [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 0],
            ],
        ],
    },
}

const point = {
    type: 'Feature',
    properties: { name: 'Site B' },
    geometry: { type: 'Point', coordinates: [2, 2] },
}

let request
let handlers
let popupSettle
let responders

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const calls = (name) => request.mock.calls.filter(([n]) => n === name)

const click = async (info) => {
    handlers['map:featureClick'](info)
    await flush()
}

// A bus event the plugin listens to, given time for a re-anchor's requests to
// answer.
const fire = async (event, payload) => {
    handlers[event](payload)
    await flush()
    await flush()
}

const anchor = () => calls('map:showPopup').at(-1)[1].latlng
const pinCoords = () =>
    calls('map:createLayer').at(-1)[1].geojson.features[0].geometry.coordinates
const emitted = () => window.mmgisAPI.emit.mock.calls.at(-1)[1]

beforeEach(async () => {
    handlers = {}
    popupSettle = null
    responders = {}
    request = vi.fn(async (name, payload) => {
        if (responders[name]) return responders[name](payload)
        if (name === 'layers:getAllConfigs') {
            return {
                [LAYER]: {
                    variables: {
                        featurePopup: {
                            enabled: true,
                            title: '{name}',
                            actions: [{ label: 'Go', event: 'plugin:x:go' }],
                        },
                    },
                },
                'lyr-plain': { variables: {} },
                [EXACT_LAYER]: {
                    variables: {
                        featurePopup: {
                            enabled: true,
                            title: '{name}',
                            latitudeProperty: 'site.lat',
                            longitudeProperty: 'lon',
                        },
                    },
                },
            }
        }
        if (name === 'map:getEngineType') return 'deckgl'
        if (name === 'map:showPopup') {
            return new Promise((resolve) => {
                popupSettle = resolve
            })
        }
        return true
    })
    window.mmgisAPI = {
        request,
        emit: vi.fn(),
        hasHandler: () => true,
        on: (event, handler) => {
            handlers[event] = handler
            return () => {}
        },
        forPlugin: () => ({ emit: vi.fn(), provide: () => () => {} }),
    }
    FeaturePopupTool.make()
    await flush()
})

afterEach(() => {
    FeaturePopupTool.destroy()
    delete window.mmgisAPI
})

describe('pinning the clicked point', () => {
    test('a click on a point that opens a card drops one click-transparent pin on it', async () => {
        await click({ feature: point, layerId: LAYER, latlng: { lat: 2, lng: 2 } })

        expect(calls('map:showPopup')).toHaveLength(1)
        const created = calls('map:createLayer').map(([, spec]) => spec)
        expect(created).toHaveLength(1)
        const [pin] = created
        expect(pin.id).toBe(PIN_ID)
        expect(pin.type).toBe('vector')
        expect(pin.interactive).toBe(false)
        expect(pin.geojson.features).toEqual([point])
        const icon = pin.variables.markerIcon
        expect(icon.iconUrl).toMatch(/^data:image\/svg\+xml/)
        // Anchored at the bottom center, so the tip marks the point.
        expect(icon.iconAnchor[0]).toBe(icon.iconSize[0] / 2)
        expect(icon.iconAnchor[1]).toBeGreaterThanOrEqual(icon.iconSize[1])
    })

    test('a click on a polygon opens the card without a pin', async () => {
        await click({ feature: polygon, layerId: LAYER, latlng: { lat: 0.5, lng: 0.5 } })

        expect(calls('map:showPopup')).toHaveLength(1)
        expect(calls('map:createLayer')).toHaveLength(0)
    })

    test('a polygon click after a point click removes the pin', async () => {
        await click({ feature: point, layerId: LAYER, latlng: { lat: 2, lng: 2 } })
        await click({ feature: polygon, layerId: LAYER, latlng: { lat: 0.5, lng: 0.5 } })

        expect(calls('map:showPopup')).toHaveLength(2)
        expect(calls('map:removeLayer')).toEqual(REMOVED)
    })

    test('the next point click re-creates the pin under the same id', async () => {
        const other = { ...point, geometry: { type: 'Point', coordinates: [3, 3] } }
        await click({ feature: point, layerId: LAYER, latlng: { lat: 2, lng: 2 } })
        await click({ feature: other, layerId: LAYER, latlng: { lat: 3, lng: 3 } })

        const created = calls('map:createLayer')
        expect(created).toHaveLength(2)
        expect(created[1][1].id).toBe(PIN_ID)
        expect(created[1][1].geojson.features).toEqual([other])
        expect(calls('map:removeLayer')).toHaveLength(0)
    })

    test('a click on empty space removes the pin', async () => {
        await click({ feature: point, layerId: LAYER, latlng: { lat: 2, lng: 2 } })
        await click({ feature: null })

        expect(calls('map:removeLayer')).toEqual(REMOVED)
    })

    test('a click on a layer without the popup removes the pin', async () => {
        await click({ feature: point, layerId: LAYER, latlng: { lat: 2, lng: 2 } })
        await click({ feature: point, layerId: 'lyr-plain', latlng: { lat: 2, lng: 2 } })

        expect(calls('map:createLayer')).toHaveLength(1)
        expect(calls('map:removeLayer')).toEqual(REMOVED)
    })

    test('the pin outlives the card: neither dismiss nor an action removes it', async () => {
        await click({ feature: point, layerId: LAYER, latlng: { lat: 2, lng: 2 } })
        popupSettle({ action: 'dismiss' })
        await flush()
        expect(calls('map:removeLayer')).toHaveLength(0)

        await click({ feature: point, layerId: LAYER, latlng: { lat: 2, lng: 2 } })
        popupSettle({ action: 'primary' })
        await flush()
        expect(calls('map:removeLayer')).toHaveLength(0)
    })

    test('destroy removes the pin', async () => {
        await click({ feature: point, layerId: LAYER, latlng: { lat: 2, lng: 2 } })
        FeaturePopupTool.destroy()

        expect(calls('map:removeLayer')).toEqual(REMOVED)
    })
})

describe('where the card points', () => {
    test('a point anchors to its own coordinate, not the click', async () => {
        await click({ feature: point, layerId: LAYER, latlng: { lat: 2.01, lng: 1.98 } })
        expect(anchor()).toEqual({ lat: 2, lng: 2 })
    })

    test('a multipoint anchors to the member nearest the click', async () => {
        const multi = {
            type: 'Feature',
            properties: { name: 'Pair' },
            geometry: { type: 'MultiPoint', coordinates: [[0, 0], [5, 5]] },
        }
        await click({ feature: multi, layerId: LAYER, latlng: { lat: 4.9, lng: 5.1 } })
        expect(anchor()).toEqual({ lat: 5, lng: 5 })
    })

    test('a polygon keeps the click location', async () => {
        await click({ feature: polygon, layerId: LAYER, latlng: { lat: 0.5, lng: 0.5 } })
        expect(anchor()).toEqual({ lat: 0.5, lng: 0.5 })
    })

    test('an action carries the anchored location', async () => {
        await click({ feature: point, layerId: LAYER, latlng: { lat: 2.01, lng: 1.98 } })
        popupSettle({ action: 'primary' })
        await flush()
        expect(emitted().latlng).toEqual({ lat: 2, lng: 2 })
    })
})

describe('anchoring to the exact position in properties', () => {
    const exactFeature = (properties) => ({
        type: 'Feature',
        properties: { name: 'Exact', ...properties },
        geometry: { type: 'Point', coordinates: [2, 2] },
    })

    test('both properties as numbers or numeric strings anchor the card and pin there', async () => {
        const feature = exactFeature({ site: { lat: '2.0005' }, lon: 1.9995 })
        await click({ feature, layerId: EXACT_LAYER, latlng: { lat: 2.01, lng: 1.98 } })

        expect(anchor()).toEqual({ lat: 2.0005, lng: 1.9995 })
        expect(pinCoords()).toEqual([1.9995, 2.0005])
    })

    test('a missing or out-of-range value falls back to the geometry', async () => {
        const feature = exactFeature({ site: { lat: 95 }, lon: 2 })
        await click({ feature, layerId: EXACT_LAYER, latlng: { lat: 2.01, lng: 1.98 } })
        expect(anchor()).toEqual({ lat: 2, lng: 2 })
    })

    test('an exact anchor is never re-anchored', async () => {
        const feature = exactFeature({ site: { lat: 2 }, lon: 2 })
        await click({ feature, layerId: EXACT_LAYER, latlng: { lat: 2, lng: 2 } })
        await fire('layer:viewportLoaded', { layerName: EXACT_LAYER })
        expect(calls('map:queryRenderedFeatures')).toHaveLength(0)
    })
})

describe('re-anchoring as the map moves', () => {
    // The same feature as a finer tile decodes it: a separate object, its
    // position closer to the truth.
    const finer = {
        type: 'Feature',
        properties: { name: 'Site B' },
        geometry: { type: 'Point', coordinates: [2.0004, 1.9997] },
    }
    const other = {
        type: 'Feature',
        properties: { name: 'Site Z' },
        geometry: { type: 'Point', coordinates: [2.0001, 2.0001] },
    }
    const FINER = { lat: 1.9997, lng: 2.0004 }

    let zoom
    const found = (...features) => {
        responders['map:queryRenderedFeatures'] = () =>
            features.map((feature) => ({ feature, layerId: LAYER }))
    }
    // The clicked layer reporting its tiles loaded for a view at zoom `z`.
    const zoomTo = (z) => {
        zoom = z
        return fire('layer:viewportLoaded', { layerName: LAYER })
    }
    // Clicked at zoom 6, as a point read from a coarse tile.
    const clickPoint = () =>
        click({ feature: point, layerId: LAYER, latlng: { lat: 2, lng: 2 } })

    beforeEach(() => {
        zoom = 6
        responders['map:getZoom'] = () => zoom
    })

    test('moves the card and pin onto the clicked feature as now drawn', async () => {
        await clickPoint()
        found(other, finer)
        await zoomTo(15)

        const [[, query]] = calls('map:queryRenderedFeatures')
        expect(query.layers).toEqual([LAYER])
        expect(query.latlng).toEqual({ lat: 2, lng: 2 })
        // Nine levels gained: the radius has grown well past the floor.
        expect(query.radius).toBeGreaterThan(100)
        expect(calls('map:movePopup')).toEqual([['map:movePopup', { latlng: FINER }]])
        expect(pinCoords()).toEqual([FINER.lng, FINER.lat])
    })

    test('ignores other layers, and views not zoomed past the anchor', async () => {
        await clickPoint()
        found(finer)
        zoom = 15
        await fire('layer:viewportLoaded', { layerName: 'lyr-elsewhere' })
        await zoomTo(6)
        await zoomTo(4)
        expect(calls('map:queryRenderedFeatures')).toHaveLength(0)
    })

    test('a found point sets the zoom later looks are measured from', async () => {
        await clickPoint()
        found(finer)
        await zoomTo(15)
        // Panning at the same zoom has nothing finer to find.
        await zoomTo(15)
        expect(calls('map:queryRenderedFeatures')).toHaveLength(1)

        await zoomTo(16)
        const [, query] = calls('map:queryRenderedFeatures').at(-1)
        expect(query.radius).toBeLessThan(10)
    })

    test('an action carries the re-anchored position', async () => {
        await clickPoint()
        found(finer)
        await zoomTo(15)
        popupSettle({ action: 'primary' })
        await flush()
        expect(emitted().latlng).toEqual(FINER)
    })

    test('leaves the anchor alone when the clicked feature is not found', async () => {
        await clickPoint()
        found(other)
        await zoomTo(15)
        expect(calls('map:movePopup')).toHaveLength(0)
        expect(calls('map:createLayer')).toHaveLength(1)
    })

    test('moves only the pin once the card has closed', async () => {
        await clickPoint()
        popupSettle({ action: 'dismiss' })
        await flush()
        found(finer)
        await zoomTo(15)
        expect(calls('map:movePopup')).toHaveLength(0)
        expect(calls('map:createLayer')).toHaveLength(2)
    })

    test('does nothing once the pin is gone', async () => {
        await clickPoint()
        await click({ feature: null })
        await zoomTo(15)
        expect(calls('map:queryRenderedFeatures')).toHaveLength(0)
    })
})
