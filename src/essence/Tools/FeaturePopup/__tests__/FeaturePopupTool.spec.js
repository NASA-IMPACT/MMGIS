import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import FeaturePopupTool from '../FeaturePopupTool'

const PIN_ID = 'feature-popup-highlight'
const REMOVED = [['map:removeLayer', { id: PIN_ID }]]
const LAYER = 'lyr-opted-in'

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

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

const calls = (name) => request.mock.calls.filter(([n]) => n === name)

const click = async (info) => {
    handlers['map:featureClick'](info)
    await flush()
}

beforeEach(async () => {
    handlers = {}
    popupSettle = null
    request = vi.fn(async (name) => {
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

describe('highlighting the clicked feature', () => {
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

    test('a click on a polygon opens the card without a highlight', async () => {
        await click({ feature: polygon, layerId: LAYER, latlng: { lat: 0.5, lng: 0.5 } })

        expect(calls('map:showPopup')).toHaveLength(1)
        expect(calls('map:createLayer')).toHaveLength(0)
    })

    test('a polygon click after a point click removes the highlight', async () => {
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

    test('a click on empty space removes the highlight', async () => {
        await click({ feature: point, layerId: LAYER, latlng: { lat: 2, lng: 2 } })
        await click({ feature: null })

        expect(calls('map:removeLayer')).toEqual(REMOVED)
    })

    test('a click on a layer without the popup removes the highlight', async () => {
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

    test('destroy removes the highlight', async () => {
        await click({ feature: point, layerId: LAYER, latlng: { lat: 2, lng: 2 } })
        FeaturePopupTool.destroy()

        expect(calls('map:removeLayer')).toEqual(REMOVED)
    })
})
