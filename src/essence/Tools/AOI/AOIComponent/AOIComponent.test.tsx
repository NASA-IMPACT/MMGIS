// Stub test file for AOIComponent.
//
// Mirrors the tinacms-portal-monorepo per-component test convention.
// Real assertions can be added once MMGIS's Jest config picks up TSX files
// under Tools/. For now this file documents the public surface contract.

import React from 'react'
import AOIComponent, {
    AOIComponentProps,
    AOIMode,
    AOIShape,
} from './AOIComponent'

describe('AOIComponent', () => {
    it('exports its public types', () => {
        const _mode: AOIMode = 'search'
        const _shape: AOIShape = 'polygon'
        // Component is exported as default
        expect(AOIComponent).toBeDefined()
        expect(_mode).toBe('search')
        expect(_shape).toBe('polygon')
    })

    it('accepts the full AOIComponentProps shape', () => {
        const props: AOIComponentProps = {
            mode: 'search',
            onModeChange: () => undefined,
            searchQuery: '',
            searchResults: [],
            onSearchQueryChange: () => undefined,
            onSearchSelect: () => undefined,
            drawShape: null,
            isDrawing: false,
            drawVerticesCount: 0,
            onDrawShapeChange: () => undefined,
            onDrawConfirm: () => undefined,
            onDrawCancel: () => undefined,
            uploadStatus: 'idle',
            onUploadFile: () => undefined,
            onClose: () => undefined,
        }
        expect(props.mode).toBe('search')
    })
})
