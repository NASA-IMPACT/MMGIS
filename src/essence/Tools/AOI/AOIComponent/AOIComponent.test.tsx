// Rendering tests for AOIComponent's draw panel: while a shape is being
// drawn the panel must show gesture hints instead of Confirm/Cancel buttons,
// and each shape's hint may only name gestures that actually work for it.

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import AOIComponent, { AOIComponentProps, AOIShape } from './AOIComponent'

const baseProps: AOIComponentProps = {
    mode: 'draw',
    onModeChange: () => undefined,
    searchQuery: '',
    searchResults: [],
    onSearchQueryChange: () => undefined,
    onSearchSelect: () => undefined,
    drawShape: null,
    isDrawing: false,
    drawVerticesCount: 0,
    onDrawShapeChange: () => undefined,
    uploadStatus: 'idle',
    onUploadFile: () => undefined,
    onClose: () => undefined,
}

function renderDrawing(shape: AOIShape, drawVerticesCount: number): string {
    return renderToStaticMarkup(
        <AOIComponent
            {...baseProps}
            drawShape={shape}
            isDrawing={true}
            drawVerticesCount={drawVerticesCount}
        />
    )
}

describe('AOIComponent drawing panel', () => {
    it('shows no Confirm/Cancel buttons while drawing', () => {
        const html = renderDrawing('polygon', 3)
        expect(html).not.toContain('aoi-draw__confirm')
        expect(html).not.toContain('aoi-draw__cancel')
        expect(html).not.toContain('Confirm')
    })

    it('tells polygon users the vertex count and every finish gesture', () => {
        const html = renderDrawing('polygon', 4)
        expect(html).toContain('4 placed (need 3+)')
        expect(html).toContain('Enter')
        expect(html).toContain('double-click')
        expect(html).toContain('first vertex')
        expect(html).toContain('Esc to cancel')
    })

    it('keeps the linestring hint to gestures that work for lines', () => {
        const html = renderDrawing('linestring', 2)
        expect(html).toContain('2 placed (need 2+)')
        expect(html).toContain('Enter')
        expect(html).toContain('double-click')
        expect(html).not.toContain('first vertex')
        expect(html).toContain('Esc to cancel')
    })

    it('does not advertise Enter or double-click for two-click shapes', () => {
        for (const shape of ['rectangle', 'circle'] as const) {
            const html = renderDrawing(shape, 1)
            expect(html).not.toContain('Enter')
            expect(html).not.toContain('double-click')
            expect(html).toContain('Esc to cancel')
        }
    })

    it('offers Esc as the only extra gesture for points', () => {
        const html = renderDrawing('point', 0)
        expect(html).toContain('place the point')
        expect(html).not.toContain('Enter')
        expect(html).toContain('Esc to cancel')
    })
})
