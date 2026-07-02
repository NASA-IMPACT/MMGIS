import React from 'react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
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

/** Gap between the trigger's bottom edge and the dropdown, in px. */
const MENU_GAP_PX = 4

type MenuPosition = { top: number; right: number }

/**
 * Presentational share control: a "Share map" trigger that opens a dropdown
 * (copy link / export PNG / export PDF). Pure — all behaviour comes in via
 * props. The trigger renders in place (positioned by the host layout); the
 * transient dropdown is portaled to document.body so an overflow-clipping
 * ancestor (like a float panel card) can't cut it off, anchored under the
 * trigger's bottom-right corner at open time.
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
    const [menuPos, setMenuPos] = useState<MenuPosition | null>(null)
    const rootRef = useRef<HTMLDivElement | null>(null)
    const triggerRef = useRef<HTMLButtonElement | null>(null)
    const menuRef = useRef<HTMLDivElement | null>(null)
    const menuId = useId()

    const close = useCallback(() => setOpen(false), [])

    // Toggle the menu; on open, anchor it just below the trigger, right-aligned
    // to the trigger's right edge (in fixed/viewport coordinates).
    const handleTriggerClick = useCallback(() => {
        if (open) {
            close()
            return
        }
        const rect = triggerRef.current?.getBoundingClientRect()
        setMenuPos(
            rect
                ? {
                      top: rect.bottom + MENU_GAP_PX,
                      right: Math.max(window.innerWidth - rect.right, 0),
                  }
                : null,
        )
        setOpen(true)
    }, [open, close])

    // Close on outside-click and Escape. "Outside" must check both the
    // in-place root (trigger) and the portaled menu element.
    useEffect(() => {
        if (!open) return
        const onPointerDown = (e: PointerEvent) => {
            const target = e.target as Node
            if (rootRef.current?.contains(target)) return
            if (menuRef.current?.contains(target)) return
            close()
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

    // The anchor was measured at open time, so ANY trigger movement desyncs
    // the portal — including layout shifts that fire no event. Watch the
    // trigger's rect each frame while open and close on drift.
    useEffect(() => {
        if (!open) return
        const anchor = triggerRef.current?.getBoundingClientRect()
        let raf = 0
        const tick = () => {
            const rect = triggerRef.current?.getBoundingClientRect()
            if (
                !rect ||
                !anchor ||
                rect.top !== anchor.top ||
                rect.left !== anchor.left ||
                rect.width !== anchor.width ||
                rect.height !== anchor.height
            ) {
                close()
                return
            }
            raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(raf)
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
                ref={triggerRef}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={open ? menuId : undefined}
                onClick={handleTriggerClick}
            >
                <span>Share map</span>
            </button>

            {open &&
                menuPos &&
                createPortal(
                    // Carries the host class so the portal keeps the plugin's
                    // token scope (colors/spacing) outside the mounted tree.
                    <div
                        className="shareExport-tool-host share-menu__dropdown"
                        id={menuId}
                        role="menu"
                        ref={menuRef}
                        style={{ top: menuPos.top, right: menuPos.right }}
                    >
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
                    </div>,
                    document.body,
                )}
        </div>
    )
}
