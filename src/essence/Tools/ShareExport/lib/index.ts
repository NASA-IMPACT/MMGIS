// The share-menu unit moved to _shared/share so MapControl can use it
// without importing this plugin; this shim keeps ShareExport's lib API stable.
export {
    ShareMenu,
    type ShareMenuProps,
    getShareMenuItems,
    type ShareMenuItem,
    type ShareMenuHandlers,
    type ShareActionKind,
    type ShareFormatFlags,
} from '../../_shared/share'
