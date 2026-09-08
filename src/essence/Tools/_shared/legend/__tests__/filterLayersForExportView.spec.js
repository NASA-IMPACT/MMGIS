import { describe, test, expect, vi } from 'vitest'
import { filterLayersForExportView } from '../filterLayersForExportView.ts'

const baseLayer = (overrides) => ({
    id: 'layer',
    title: 'Layer',
    description: null,
    opacity: 1,
    visible: true,
    type: 'none',
    cog: null,
    ...overrides,
})

describe('filterLayersForExportView', () => {
    test('drops a layer with opacity 0', () => {
        const layers = [baseLayer({ id: 'a', opacity: 0 })]
        expect(filterLayersForExportView(layers)).toEqual([])
    })

    test('keeps a barely-visible layer', () => {
        const layers = [baseLayer({ id: 'a', opacity: 0.01 })]
        expect(filterLayersForExportView(layers)).toHaveLength(1)
    })

    test('keeps every toggled-on layer that paints at all', () => {
        const layers = [
            baseLayer({ id: 'a' }),
            baseLayer({ id: 'b', opacity: 0.5 }),
            baseLayer({ id: 'c', opacity: 0 }),
        ]
        expect(filterLayersForExportView(layers).map((l) => l.id)).toEqual([
            'a',
            'b',
        ])
    })

    test('logs the dropped layers when filtering empties a non-empty layer set', () => {
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
        const layers = [baseLayer({ id: 'a', title: 'Only layer', opacity: 0 })]
        expect(filterLayersForExportView(layers)).toEqual([])
        expect(infoSpy).toHaveBeenCalledTimes(1)
        expect(infoSpy.mock.calls[0][1]).toEqual(
            expect.arrayContaining([expect.stringContaining('Only layer')]),
        )
        infoSpy.mockRestore()
    })

    test('does not log when nothing was filtered out, or when there was nothing to filter', () => {
        const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
        filterLayersForExportView([baseLayer({ id: 'a' })])
        filterLayersForExportView([])
        expect(infoSpy).not.toHaveBeenCalled()
        infoSpy.mockRestore()
    })
})
