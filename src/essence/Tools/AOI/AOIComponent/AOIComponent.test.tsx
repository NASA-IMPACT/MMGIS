// Rendering tests for AOIComponent's draw panel: while a shape is being
// drawn the panel must show gesture hints instead of Confirm/Cancel buttons,
// and each shape's hint may only name gestures that actually work for it —
// including not naming finish gestures that are still inert at that vertex.

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

/** The hint paragraph alone, so absence assertions cannot match other markup. */
function hint(shape: AOIShape, drawVerticesCount: number): string {
    const html = renderDrawing(shape, drawVerticesCount)
    const match = html.match(/<p class="aoi-panel__hint">([^<]*)<\/p>/)
    if (!match) throw new Error(`no hint rendered for ${shape}`)
    return match[1]
}

describe('AOIComponent drawing panel', () => {
    it('shows no Confirm/Cancel buttons while drawing', () => {
        const html = renderDrawing('polygon', 3)
        expect(html).not.toContain('aoi-draw__confirm')
        expect(html).not.toContain('aoi-draw__cancel')
        expect(html).not.toContain('Confirm')
    })

    it('tells polygon users the vertex count and every finish gesture', () => {
        const text = hint('polygon', 4)
        expect(text).toContain('4 placed (need 3+)')
        expect(text).toContain('Enter')
        expect(text).toContain('double-click')
        expect(text).toContain('first vertex')
        expect(text).toContain('Esc to cancel')
    })

    it('withholds the polygon finish gestures until three vertices', () => {
        const text = hint('polygon', 2)
        expect(text).toContain('2 placed (need 3+)')
        expect(text).not.toContain('Enter')
        expect(text).not.toContain('double-click')
        expect(text).toContain('Esc to cancel')
    })

    it('keeps the linestring hint to gestures that work for lines', () => {
        const text = hint('linestring', 2)
        expect(text).toContain('2 placed (need 2+)')
        expect(text).toContain('Enter')
        expect(text).toContain('double-click')
        expect(text).not.toContain('first vertex')
        expect(text).toContain('Esc to cancel')
    })

    it('withholds the linestring finish gestures until two vertices', () => {
        const text = hint('linestring', 1)
        expect(text).toContain('1 placed (need 2+)')
        expect(text).not.toContain('Enter')
        expect(text).not.toContain('double-click')
        expect(text).toContain('Esc to cancel')
    })

    it('does not advertise Enter or double-click for two-click shapes', () => {
        for (const shape of ['rectangle', 'circle'] as const) {
            for (const count of [0, 1]) {
                const text = hint(shape, count)
                expect(text).not.toContain('Press Enter')
                expect(text).not.toContain('double-click')
                expect(text).toContain('Esc to cancel')
            }
        }
    })

    it('says which click comes next for two-click shapes', () => {
        expect(hint('rectangle', 0)).toContain('Click the first corner')
        expect(hint('rectangle', 1)).toContain('Click the opposite corner')
        expect(hint('circle', 0)).toContain('Click the center')
        expect(hint('circle', 1)).toContain('Click the edge')
    })

    it('offers Esc as the only extra gesture for points', () => {
        const text = hint('point', 0)
        expect(text).toContain('place the point')
        expect(text).not.toContain('Enter')
        expect(text).toContain('Esc to cancel')
    })
})
