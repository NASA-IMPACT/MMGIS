import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    mmgisGetDataCoverage,
    mmgisGetLayerDataCoverage,
    mmgisOnDataCoverageChanged,
} from '../mmgisAPI'

const request = vi.fn()
const on = vi.fn()

beforeEach(() => {
    request.mockReset().mockResolvedValue(null)
    on.mockReset().mockReturnValue(() => {})
    ;(window as any).mmgisAPI = { request, on, hasHandler: () => true }
})

afterEach(() => {
    delete (window as any).mmgisAPI
})

describe('data coverage adapters', () => {
    test('asks for every layer when given no identifier', async () => {
        await mmgisGetDataCoverage()
        expect(request).toHaveBeenCalledWith('layers:getDataCoverage', undefined)
    })

    test('asks for one layer by identifier', async () => {
        await mmgisGetLayerDataCoverage('Flood Days')
        expect(request).toHaveBeenCalledWith(
            'layers:getDataCoverage',
            'Flood Days',
        )
    })

    test('resolves null against a core without the handler', async () => {
        ;(window as any).mmgisAPI.hasHandler = () => false
        expect(await mmgisGetDataCoverage()).toBeNull()
        expect(request).not.toHaveBeenCalled()
    })

    test('subscribes to coverage changes', () => {
        const handler = vi.fn()
        mmgisOnDataCoverageChanged(handler)
        expect(on).toHaveBeenCalledWith(
            'layers:dataCoverageChanged',
            expect.any(Function),
        )
    })
})
