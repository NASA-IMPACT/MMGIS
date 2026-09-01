import { test, expect, vi, afterEach } from 'vitest'
import { enableComparison, disableComparison } from '../adapters/handlers.ts'

/**
 * The tool's whole coupling to MMGIS is these two requests, so what matters is
 * the name and shape each one puts on the bus. Core destructures each payload
 * by field name (Map_ hands 'map:comparison:enable' to MapComparison.enable),
 * so a renamed field arrives as undefined and takes that side's default; a
 * renamed request has no handler at all and mmgisAPI.request throws.
 */

const setupMock = () => {
    const requests = []
    global.window = global.window || {}
    global.window.mmgisAPI = {
        request: async (name, params) => {
            requests.push({ name, params })
            return null
        },
        hasHandler: () => true,
        on: () => () => {},
        emit: () => {},
    }
    return requests
}

afterEach(() => {
    vi.restoreAllMocks()
})

test.describe('Comparison handlers', () => {
    test('enableComparison names both sides and the layout', async () => {
        const requests = setupMock()
        await enableComparison({
            leftLayers: ['co2'],
            rightLayers: ['ch4'],
            layout: 'sideBySide',
        })

        expect(requests).toEqual([
            {
                name: 'map:comparison:enable',
                params: {
                    leftLayers: ['co2'],
                    rightLayers: ['ch4'],
                    layout: 'sideBySide',
                },
            },
        ])
    })

    test('enableComparison carries the swipe layout just as explicitly', async () => {
        const requests = setupMock()
        await enableComparison({
            leftLayers: ['co2'],
            rightLayers: ['ch4'],
            layout: 'swipe',
        })
        expect(requests[0].params.layout).toBe('swipe')
    })

    test('enableComparison carries a pinned date for the side that has one', async () => {
        const requests = setupMock()
        await enableComparison({
            leftLayers: ['co2', 'roads'],
            rightLayers: ['co2', 'roads'],
            rightDate: '2024-06-15T00:00:00Z',
            layout: 'swipe',
        })

        expect(requests[0].params).toEqual({
            leftLayers: ['co2', 'roads'],
            rightLayers: ['co2', 'roads'],
            rightDate: '2024-06-15T00:00:00Z',
            layout: 'swipe',
        })
    })

    test('disableComparison asks for teardown with no payload', async () => {
        const requests = setupMock()
        await disableComparison()

        expect(requests).toEqual([
            { name: 'map:comparison:disable', params: undefined },
        ])
    })
})
