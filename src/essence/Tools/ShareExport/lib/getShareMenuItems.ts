import type { ShareActionKind, ShareFormatFlags } from './types'
import { getEnabledShareActions } from './getEnabledShareActions'

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

const ICONS: Record<ShareActionKind, string> = {
    link: 'mdi-link-variant',
    png: 'mdi-image-outline',
    pdf: 'mdi-file-pdf-box',
}

/**
 * Single source of truth for the dropdown's rows: maps the enabled actions
 * (from getEnabledShareActions) to renderable items, each wired to the matching
 * handler. The first export item carries a separator so the link is visually
 * divided from the downloads. Pure and DOM-free so the gating + handler wiring
 * can be asserted without a render.
 */
export function getShareMenuItems(
    formats: ShareFormatFlags,
    handlers: ShareMenuHandlers,
): ShareMenuItem[] {
    const actions = getEnabledShareActions(formats)
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
