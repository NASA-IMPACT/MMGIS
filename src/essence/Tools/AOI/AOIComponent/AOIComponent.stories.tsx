// Stub Storybook story for AOIComponent.
//
// MMGIS does not run Storybook today. This file mirrors the tinacms-portal-monorepo
// convention (ComponentName/ComponentName.stories.tsx) so the component is ready
// to ship if a Storybook workbench is added later. Until then it's a documented
// prop matrix only.

import React from 'react'
import AOIComponent, { AOIComponentProps } from './AOIComponent'

export default {
    title: 'Tools/AOIComponent',
    component: AOIComponent,
}

const baseProps: AOIComponentProps = {
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

export const SearchMode = () => <AOIComponent {...baseProps} mode="search" />

export const InspectMode = () => <AOIComponent {...baseProps} mode="inspect" />

export const DrawShapePicker = () => <AOIComponent {...baseProps} mode="draw" />

export const DrawInProgressPolygon = () => (
    <AOIComponent
        {...baseProps}
        mode="draw"
        drawShape="polygon"
        isDrawing
        drawVerticesCount={2}
    />
)

export const UploadIdle = () => <AOIComponent {...baseProps} mode="upload" />

export const UploadError = () => (
    <AOIComponent
        {...baseProps}
        mode="upload"
        uploadStatus="error"
        uploadError="Could not parse that file."
    />
)
