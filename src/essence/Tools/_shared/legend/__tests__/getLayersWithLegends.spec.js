import { describe, test, expect, afterEach } from 'vitest'
import { getLayersWithLegends } from '../getLayersWithLegends.ts'

const FILTERED = 'Filtered_0123456789abcdef'
const LISTED = 'Listed_fedcba9876543210'

const setupMock = (responses) => {
    global.window = global.window || {}
    global.window.mmgisAPI = {
        request: async (name) => {
            if (responses[name] === undefined)
                throw new Error(`No handler for ${name}`)
            return responses[name]
        },
        hasHandler: (name) => responses[name] !== undefined,
        on: () => () => {},
        emit: () => {},
    }
}

describe('getLayersWithLegends', () => {
    afterEach(() => {
        delete global.window.mmgisAPI
    })

    // 'layers:getListed' says what the panel's list shows, which the
    // LayerFilter plugin narrows. A layer it filters out is still toggled on
    // and still painting, so the export must still be able to legend it —
    // only the panel drops it, in its own adapter.
    test('keeps a toggled-on layer that is filtered out of the layer lists', async () => {
        setupMock({
            'layers:getAllConfigs': {
                [FILTERED]: { display_name: 'Filtered' },
                [LISTED]: { display_name: 'Listed' },
            },
            'layers:getVisible': { [FILTERED]: true, [LISTED]: true },
            'layers:getAllOpacities': { [FILTERED]: 1, [LISTED]: 1 },
            'layers:getListed': { [FILTERED]: false, [LISTED]: true },
        })
        const layers = await getLayersWithLegends({ showOnlyVisible: true })
        expect(layers.map((l) => l.title)).toEqual(['Filtered', 'Listed'])
    })
})
