import React from 'react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ShareFormatFlags } from '../../types'
import { getShareMenuItems } from '../../getShareMenuItems'
import { SHARE_MENU_ICONS } from './icons'

export type ShareMenuProps = {
    /** Which downloadable formats are enabled. The link is always shown. */
    formats: ShareFormatFlags
    /** True while a screenshot/export is in progress (disables export items). */
    busy?: boolean
    /** True briefly after a successful copy (swaps the link item label). */
    copied?: boolean
    /** Copy the self-contained share URL to the clipboard. */
    onCopyLink: () => void
    /** Download the current map as a PNG. */
    onDownloadPng?: () => void
    /** Download the current map as a PDF. */
    onDownloadPdf?: () => void
}

/**
 * Presentational share control: a compact "Share map" trigger button that opens
 * a small dropdown menu (copy link / export PNG / export PDF). Pure and
 * framework-agnostic — all behaviour comes in via props. The rows it renders
 * come from getShareMenuItems, so the config toggles directly gate the menu.
 * Mirrors the reference prototype's top-right "Share map" → dropdown.
 */
export function ShareMenu({
    formats,
    busy = false,
    copied = false,
    onCopyLink,
    onDownloadPng,
    onDownloadPdf,
}: ShareMenuProps) {
    const items = getShareMenuItems(formats, {
        onCopyLink,
        onDownloadPng,
        onDownloadPdf,
    })

    const [open, setOpen] = useState(false)
    const rootRef = useRef<HTMLDivElement | null>(null)
    const menuId = useId()

    const close = useCallback(() => setOpen(false), [])

    // Close on outside-click and Escape while the menu is open.
    useEffect(() => {
        if (!open) return
        const onPointerDown = (e: PointerEvent) => {
            if (!rootRef.current?.contains(e.target as Node)) close()
        }
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') close()
        }
        document.addEventListener('pointerdown', onPointerDown, true)
        document.addEventListener('keydown', onKeyDown, true)
        return () => {
            document.removeEventListener('pointerdown', onPointerDown, true)
            document.removeEventListener('keydown', onKeyDown, true)
        }
    }, [open, close])

    // Run an action then collapse the menu.
    const run = useCallback(
        (fn?: () => void) => {
            fn?.()
            close()
        },
        [close],
    )

    return (
        <div className="share-menu" ref={rootRef}>
            <button
                type="button"
                className="share-menu__trigger"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={open ? menuId : undefined}
                onClick={() => setOpen((v) => !v)}
            >
                <span>Share map</span>
            </button>

            {open && (
                <div className="share-menu__dropdown" id={menuId} role="menu">
                    {items.map((item) => {
                        const Icon = SHARE_MENU_ICONS[item.icon]
                        return (
                            <React.Fragment key={item.kind}>
                                {item.separatorBefore && (
                                    <div className="share-menu__separator" />
                                )}
                                <button
                                    type="button"
                                    role="menuitem"
                                    className="share-menu__item"
                                    onClick={() => run(item.onClick)}
                                    disabled={item.gatedByBusy && busy}
                                >
                                    {Icon && (
                                        <Icon className="share-menu__item-icon" />
                                    )}
                                    <span>
                                        {item.kind === 'link' && copied
                                            ? 'Link copied'
                                            : item.label}
                                    </span>
                                </button>
                            </React.Fragment>
                        )
                    })}
                </div>
            )}
        </div>
    )
}
