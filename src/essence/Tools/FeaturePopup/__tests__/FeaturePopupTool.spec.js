import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import FeaturePopupTool from '../FeaturePopupTool'

const HIGHLIGHT_ID = 'feature-popup-highlight'
const CASING_ID = 'feature-popup-highlight-casing'
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
    test('a click that opens a card outlines the feature: a white casing under a colored ring', async () => {
        await click({ feature: polygon, layerId: LAYER, latlng: { lat: 0.5, lng: 0.5 } })

        expect(calls('map:showPopup')).toHaveLength(1)
        const created = calls('map:createLayer').map(([, spec]) => spec)
        expect(created.map((spec) => spec.id)).toEqual([CASING_ID, HIGHLIGHT_ID])
        created.forEach((spec) => {
            expect(spec.type).toBe('vector')
            expect(spec.interactive).toBe(false)
            expect(spec.geojson.features).toEqual([polygon])
            expect(spec.style.fillOpacity).toBe(0)
        })
        const [casing, ring] = created
        expect(casing.style.weight).toBeGreaterThan(ring.style.weight)
        expect(casing.style.radius).toBe(ring.style.radius)
    })

    test('the next card-opening click re-creates the outline under the same id', async () => {
        await click({ feature: polygon, layerId: LAYER, latlng: { lat: 0.5, lng: 0.5 } })
        await click({ feature: point, layerId: LAYER, latlng: { lat: 2, lng: 2 } })

        const created = calls('map:createLayer')
        expect(created).toHaveLength(4)
        expect(created.slice(2).map(([, spec]) => spec.id)).toEqual([CASING_ID, HIGHLIGHT_ID])
        created.slice(2).forEach(([, spec]) => {
            expect(spec.geojson.features).toEqual([point])
        })
        expect(calls('map:removeLayer')).toHaveLength(0)
    })

    test('a click on empty space removes the outline', async () => {
        await click({ feature: polygon, layerId: LAYER, latlng: { lat: 0.5, lng: 0.5 } })
        await click({ feature: null })

        expect(calls('map:removeLayer')).toEqual([
            ['map:removeLayer', { id: CASING_ID }],
            ['map:removeLayer', { id: HIGHLIGHT_ID }],
        ])
    })

    test('a click on a layer without the popup removes the outline', async () => {
        await click({ feature: polygon, layerId: LAYER, latlng: { lat: 0.5, lng: 0.5 } })
        await click({ feature: point, layerId: 'lyr-plain', latlng: { lat: 2, lng: 2 } })

        expect(calls('map:createLayer')).toHaveLength(2)
        expect(calls('map:removeLayer')).toHaveLength(2)
    })

    test('the outline outlives the card: neither dismiss nor an action removes it', async () => {
        await click({ feature: polygon, layerId: LAYER, latlng: { lat: 0.5, lng: 0.5 } })
        popupSettle({ action: 'dismiss' })
        await flush()
        expect(calls('map:removeLayer')).toHaveLength(0)

        await click({ feature: polygon, layerId: LAYER, latlng: { lat: 0.5, lng: 0.5 } })
        popupSettle({ action: 'primary' })
        await flush()
        expect(calls('map:removeLayer')).toHaveLength(0)
    })

    test('destroy removes the outline', async () => {
        await click({ feature: polygon, layerId: LAYER, latlng: { lat: 0.5, lng: 0.5 } })
        FeaturePopupTool.destroy()

        expect(calls('map:removeLayer')).toEqual([
            ['map:removeLayer', { id: CASING_ID }],
            ['map:removeLayer', { id: HIGHLIGHT_ID }],
        ])
    })
})
