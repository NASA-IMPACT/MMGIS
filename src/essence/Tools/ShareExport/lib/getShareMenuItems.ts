import type { ShareActionKind, ShareFormatFlags } from './types'

/** A renderable share-menu item: its kind, the label/icon shown, the handler
 *  it fires, whether a separator precedes it, and whether it respects `busy`. */
export type ShareMenuItem = {
    kind: ShareActionKind
    label: string
    icon: string
    onClick?: () => void
    /** True when a divider should render immediately before this item. */
    separatorBefore: boolean
    /** True for the export items (disabled while a capture is in progress). */
    gatedByBusy: boolean
}

export type ShareMenuHandlers = {
    onCopyLink: () => void
    onDownloadPng?: () => void
    onDownloadPdf?: () => void
}

const LABELS: Record<ShareActionKind, string> = {
    link: 'Copy link to view',
    png: 'Export as PNG',
    pdf: 'Export as PDF',
}

// Lucide icon names (rendered by the ShareMenu's inline SVGs), matching the
// reference prototype's share menu.
const ICONS: Record<ShareActionKind, string> = {
    link: 'link-2',
    png: 'file-image',
    pdf: 'download',
}

/**
 * Single source of truth for the dropdown's rows: the link is always present,
 * PNG/PDF only when their toggle is on; the first export row carries a
 * separator. Pure and DOM-free so gating + wiring are testable without a render.
 */
export function getShareMenuItems(
    formats: ShareFormatFlags,
    handlers: ShareMenuHandlers,
): ShareMenuItem[] {
    const actions: ShareActionKind[] = ['link']
    if (formats.png) actions.push('png')
    if (formats.pdf) actions.push('pdf')
    const handlerFor: Record<ShareActionKind, (() => void) | undefined> = {
        link: handlers.onCopyLink,
        png: handlers.onDownloadPng,
        pdf: handlers.onDownloadPdf,
    }

    let seenExport = false
    return actions.map((kind) => {
        const isExport = kind === 'png' || kind === 'pdf'
        const separatorBefore = isExport && !seenExport
        if (isExport) seenExport = true
        return {
            kind,
            label: LABELS[kind],
            icon: ICONS[kind],
            onClick: handlerFor[kind],
            separatorBefore,
            gatedByBusy: isExport,
        }
    })
}
