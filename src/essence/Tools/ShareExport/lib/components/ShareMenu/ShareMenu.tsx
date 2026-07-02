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
 * Presentational share control: a compact "Share map" trigger button that opens
 * a small dropdown menu (copy link / export PNG / export PDF). Pure and
 * framework-agnostic — all behaviour comes in via props. The rows it renders
 * come from getShareMenuItems, so the config toggles directly gate the menu.
 *
 * The trigger renders in place (positioned by the host layout, e.g. a floating
 * panel card); the transient dropdown is portaled to document.body so an
 * overflow-clipping ancestor (like the float zone's panel card) can't cut it
 * off. The portal is position:fixed, anchored under the trigger's bottom-right
 * corner via getBoundingClientRect, measured when the menu opens. Scroll and
 * resize invalidate that measurement, so both simply close the menu.
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

    // Close on outside-click and Escape while the menu is open. The dropdown
    // lives in a portal, so "outside" must check containment against both the
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

    // The portal's fixed position was measured when the menu opened, so ANY
    // movement of the trigger desyncs it — scroll and resize, but also layout
    // shifts that fire no event (e.g. a sibling tool in the same float card
    // re-rendering taller). While the menu is open, watch the trigger's rect
    // each animation frame and close on drift. The menu is transient, so the
    // one getBoundingClientRect per frame is negligible.
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
