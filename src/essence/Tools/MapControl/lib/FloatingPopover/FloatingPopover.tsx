import React, { useLayoutEffect, useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'

export interface FloatingPopoverProps {
    anchorRef: React.RefObject<HTMLElement | null>
    isOpen: boolean
    onClose?: () => void
    placement?: 'top' | 'bottom' | 'left' | 'right'
    offset?: number
    className?: string
    /** Ties the anchor's aria-controls to this popover. */
    id?: string
    /** Accessible name for the dialog. */
    label?: string
    /**
     * A dialog is a surface the user operates. A tooltip only describes its
     * anchor: it takes no focus of its own and is named by the text it
     * carries, so it needs neither a tab stop nor a label.
     */
    role?: 'dialog' | 'tooltip'
    /**
     * Moves focus into the popover on open. Leave false for informational
     * content, where taking focus off the trigger is disruptive.
     */
    autoFocus?: boolean
    children: React.ReactNode
}

export const FloatingPopover: React.FC<FloatingPopoverProps> = ({
    anchorRef,
    isOpen,
    onClose,
    placement = 'bottom',
    offset = 8,
    className = '',
    id,
    label,
    role = 'dialog',
    autoFocus = false,
    children
}) => {
    const popupRef = useRef<HTMLDivElement>(null)
    const [pos, setPos] = useState({ top: 0, left: 0 })
    // Whether focus currently sits inside the popover. Read on close, when the
    // portal's DOM is already detached and document.activeElement has fallen
    // back to <body>, so it can't be worked out from the DOM by then.
    const focusInsideRef = useRef(false)

    useEffect(() => {
        if (!isOpen) return

        const trackFocus = () => {
            focusInsideRef.current = !!(
                popupRef.current &&
                document.activeElement &&
                popupRef.current.contains(document.activeElement)
            )
        }

        trackFocus()
        document.addEventListener('focusin', trackFocus)
        return () => document.removeEventListener('focusin', trackFocus)
    }, [isOpen])

    // Escape closes from anywhere, including while focus sits on the trigger.
    useEffect(() => {
        if (!isOpen || !onClose) return

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation()
                onClose()
            }
        }

        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [isOpen, onClose])

    // The portal renders at the end of document.body, so focus is placed and
    // restored explicitly rather than following DOM order.
    useEffect(() => {
        if (!isOpen) return
        const previouslyFocused = document.activeElement as HTMLElement | null

        if (autoFocus) {
            const focusTarget =
                popupRef.current?.querySelector<HTMLElement>(
                    'input, button, [href], select, textarea, [tabindex]:not([tabindex="-1"])',
                ) || popupRef.current
            focusTarget?.focus()
        }

        return () => {
            // Only reclaim focus if the popover held it as it closed; a click
            // elsewhere has already placed focus where the user wants it.
            if (!focusInsideRef.current) return
            focusInsideRef.current = false

            const anchor = anchorRef.current
            const restoreTo =
                anchor && document.contains(anchor) ? anchor : previouslyFocused
            restoreTo?.focus()
        }
    }, [isOpen, autoFocus, anchorRef])

    // Close on outside click
    useEffect(() => {
        if (!isOpen || !onClose) return

        const handleClickOutside = (e: MouseEvent) => {
            const target = e.target as HTMLElement
            // If the anchor exists and the click is inside it, ignore (the button toggle will handle it)
            const clickedInsideAnchor = anchorRef.current && anchorRef.current.contains(target)
            // If the click is inside the popup itself, ignore
            const clickedInsidePopup = popupRef.current && popupRef.current.contains(target)

            if (!clickedInsideAnchor && !clickedInsidePopup) {
                onClose()
            }
        }

        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [isOpen, onClose, anchorRef])

    // Update position
    useLayoutEffect(() => {
        if (!isOpen) return

        const updatePosition = () => {
            if (!anchorRef.current || !popupRef.current) return

            const anchorRect = anchorRef.current.getBoundingClientRect()
            const popupRect = popupRef.current.getBoundingClientRect()

            let top = 0
            let left = 0

            switch (placement) {
                case 'top':
                    top = anchorRect.top - popupRect.height - offset
                    left = anchorRect.left + (anchorRect.width / 2) - (popupRect.width / 2)
                    break
                case 'bottom':
                    top = anchorRect.bottom + offset
                    left = anchorRect.left + (anchorRect.width / 2) - (popupRect.width / 2)
                    break
                case 'left':
                    top = anchorRect.top + (anchorRect.height / 2) - (popupRect.height / 2)
                    left = anchorRect.left - popupRect.width - offset
                    break
                case 'right':
                    top = anchorRect.top + (anchorRect.height / 2) - (popupRect.height / 2)
                    left = anchorRect.right + offset
                    break
            }

            // Simple viewport bounds checking
            if (left < 8) left = 8
            if (top < 8) {
                if (placement === 'top') {
                    top = anchorRect.bottom + offset
                } else {
                    top = 8
                }
            }
            if (left + popupRect.width > window.innerWidth - 8) {
                left = window.innerWidth - popupRect.width - 8
            }
            if (top + popupRect.height > window.innerHeight - 8) {
                if (placement === 'bottom') {
                    top = anchorRect.top - popupRect.height - offset
                } else {
                    top = window.innerHeight - popupRect.height - 8
                }
            }

            // Prevent React state updates if the position hasn't changed to avoid infinite loops
            setPos(prev => {
                if (Math.abs(prev.top - top) < 1 && Math.abs(prev.left - left) < 1) {
                    return prev
                }
                return { top, left }
            })
        }

        updatePosition()
        window.addEventListener('resize', updatePosition)
        window.addEventListener('scroll', updatePosition, true)

        // Content can change size after opening — a validation message
        // appearing, a calendar switching to a longer month — which moves where
        // the popover should sit relative to its anchor.
        const contentObserver =
            typeof ResizeObserver !== 'undefined'
                ? new ResizeObserver(updatePosition)
                : null
        if (popupRef.current) contentObserver?.observe(popupRef.current)

        // Wait a tick and update again in case children render changed dimensions
        const timeout = setTimeout(updatePosition, 0)

        return () => {
            clearTimeout(timeout)
            contentObserver?.disconnect()
            window.removeEventListener('resize', updatePosition)
            window.removeEventListener('scroll', updatePosition, true)
        }
    }, [isOpen, placement, offset, anchorRef])

    if (!isOpen) return null

    return createPortal(
        <div
            ref={popupRef}
            id={id}
            role={role}
            aria-label={label}
            tabIndex={role === 'tooltip' ? undefined : -1}
            className={`floating-popover-portal ${className}`}
            style={{
                position: 'fixed',
                zIndex: 999999,
                top: `${pos.top}px`,
                left: `${pos.left}px`,
                // visibility hidden on first render if pos is 0,0 to prevent flicker in top left
                visibility: pos.top === 0 && pos.left === 0 ? 'hidden' : 'visible'
            }}
        >
            {children}
        </div>,
        document.body
    )
}
