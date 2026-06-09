// Shared domain types for the AOI library. Framework-agnostic — no MMGIS.
// Component-facing types only; adapter-side types (search entries, parse
// results) live next to their helpers in adapters/.

export type AOIMode = 'search' | 'inspect' | 'draw' | 'upload'
export type AOIShape = 'point' | 'linestring' | 'polygon' | 'rectangle' | 'circle'
export type UploadStatus = 'idle' | 'parsing' | 'error'
export type AnalysisStatus = 'idle' | 'running'

/** A search-result row shown in the UI (no source geometry). */
export interface AOISearchResult {
    id: string
    label: string
    kind: 'city' | 'county' | 'state'
}
