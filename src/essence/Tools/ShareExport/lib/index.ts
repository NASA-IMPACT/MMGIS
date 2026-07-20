// Components
export { ShareMenu, type ShareMenuProps } from './components/ShareMenu/ShareMenu'

// Pure helpers / domain types
export {
    getShareMenuItems,
    type ShareMenuItem,
    type ShareMenuHandlers,
} from './getShareMenuItems'
export type { ShareActionKind, ShareFormatFlags } from './types'

// Side-effect import of compiled styles
import './styles/index.scss'
