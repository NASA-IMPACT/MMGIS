import React from 'react'
import { useRef, useState, type KeyboardEvent } from 'react'

export type PopoverMenuItem = {
    id: string
    label: string
    /** Modifier suffix of the icon mask class, e.g. 'zoom-to-layer'. */
    icon?: string
    disabled?: boolean
    /** Hover text; the place to explain why an item is disabled. */
    title?: string
    /** Draws a separator above this item. */
    dividerBefore?: boolean
    onSelect: () => void
}

export type PopoverMenuProps = {
    items: PopoverMenuItem[]
    /** Runs after an item's own onSelect — where the owner dismisses the menu. */
    onSelect?: () => void
    className?: string
}

/**
 * A list of actions for a popover surface.
 *
 * Placement, dismissal and focus restoration belong to the popover wrapping
 * this; all that lives here is the list itself and the keys that move through
 * it.
 */
export function PopoverMenu({
    items,
    onSelect,
    className = '',
}: PopoverMenuProps) {
    const itemRefs = useRef<Array<HTMLButtonElement | null>>([])
    // The menu holds one tab stop, and arrowing moves it. Tab therefore leaves
    // the menu rather than walking its items, which is how a menu is expected
    // to behave. Clamped because the list can shrink under a held index.
    const [focusedIndex, setFocusedIndex] = useState(0)
    const tabStop = Math.min(focusedIndex, Math.max(items.length - 1, 0))

    const focusItem = (index: number) => {
        const count = items.length
        if (count === 0) return
        // Arrowing past either end wraps, as menus conventionally do.
        itemRefs.current[((index % count) + count) % count]?.focus()
    }

    const handleKeyDown = (
        e: KeyboardEvent<HTMLButtonElement>,
        index: number,
    ) => {
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault()
                focusItem(index + 1)
                break
            case 'ArrowUp':
                e.preventDefault()
                focusItem(index - 1)
                break
            case 'Home':
                e.preventDefault()
                focusItem(0)
                break
            case 'End':
                e.preventDefault()
                focusItem(items.length - 1)
                break
        }
        // Enter and Space need no handling — a <button> raises click for both.
    }

    const handleSelect = (item: PopoverMenuItem) => {
        if (item.disabled) return
        item.onSelect()
        onSelect?.()
    }

    return (
        <div role="menu" className={`blocks-popover-menu ${className}`.trim()}>
            {items.map((item, index) => (
                <React.Fragment key={item.id}>
                    {item.dividerBefore && (
                        <div
                            role="separator"
                            className="blocks-popover-menu__divider"
                        />
                    )}
                    {/* Marked disabled through aria rather than the disabled
                        attribute: a disabled button takes no pointer events, so
                        the browser never shows the title explaining why it is
                        inert, and arrowing through the menu would step over the
                        one item whose absence needs explaining. The select
                        handler is what actually holds it shut. */}
                    <button
                        ref={(el) => {
                            itemRefs.current[index] = el
                        }}
                        type="button"
                        role="menuitem"
                        className={[
                            'blocks-popover-menu__item',
                            item.disabled
                                ? 'blocks-popover-menu__item--disabled'
                                : '',
                        ]
                            .filter(Boolean)
                            .join(' ')}
                        aria-disabled={item.disabled || undefined}
                        title={item.title}
                        tabIndex={index === tabStop ? 0 : -1}
                        onClick={() => handleSelect(item)}
                        onKeyDown={(e) => handleKeyDown(e, index)}
                        onFocus={() => setFocusedIndex(index)}
                    >
                        {item.icon && (
                            <span
                                className={`blocks-popover-menu__icon blocks-popover-menu__icon--${item.icon}`}
                            />
                        )}
                        <span className="blocks-popover-menu__label">
                            {item.label}
                        </span>
                    </button>
                </React.Fragment>
            ))}
        </div>
    )
}
