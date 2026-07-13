// Components
export { AOIPanel, type AOIPanelProps } from './geo/AOIPanel/AOIPanel'
export { SearchPanel, type SearchPanelProps } from './geo/SearchPanel/SearchPanel'
export { InspectPanel } from './geo/InspectPanel/InspectPanel'
export { DrawPanel, type DrawPanelProps } from './geo/DrawPanel/DrawPanel'
export { UploadPanel, type UploadPanelProps } from './geo/UploadPanel/UploadPanel'
export { AnalyzingPanel, type AnalyzingPanelProps } from './geo/AnalyzingPanel/AnalyzingPanel'
export { AOITooltip, type AOITooltipProps } from './geo/AOITooltip/AOITooltip'

// Shared domain types (component-facing only)
export type {
    AOIMode,
    AOIShape,
    UploadStatus,
    AnalysisStatus,
    AOISearchResult,
} from './types'

// Side-effect import of compiled styles
import './styles/index.scss'
