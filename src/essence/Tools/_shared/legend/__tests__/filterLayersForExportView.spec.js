import { describe, test, expect } from 'vitest'
import { filterLayersForExportView } from '../filterLayersForExportView.ts'

const layer = (id, opacity) => ({
    id,
    title: id,
    description: null,
    opacity,
    visible: true,
    type: 'none',
    cog: null,
})

describe('filterLayersForExportView', () => {
    // A fully transparent layer is not on the export, so it gets no row; one
    // that paints at all, however faintly, does.
    test('drops a layer with opacity 0 and keeps every layer that paints', () => {
        const layers = [layer('a', 1), layer('b', 0.01), layer('c', 0)]
        expect(filterLayersForExportView(layers).map((l) => l.id)).toEqual([
            'a',
            'b',
        ])
    })
})
