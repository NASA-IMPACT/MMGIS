// Portable share-menu unit, shared by the ShareExport and MapControl plugins.
export { ShareMenu, type ShareMenuProps } from './ShareMenu'
export {
    getShareMenuItems,
    type ShareMenuItem,
    type ShareMenuHandlers,
} from './getShareMenuItems'
export type { ShareActionKind, ShareFormatFlags } from './types'
export {
    resolveIncludeLegend,
    type IncludeLegendVars,
} from './resolveIncludeLegend'

// Side-effect import of compiled styles
import './share-menu.scss'
