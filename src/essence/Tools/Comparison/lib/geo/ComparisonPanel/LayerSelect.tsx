import React from 'react'
import {
    useCallback,
    useId,
    useLayoutEffect,
    useRef,
    useState,
    type KeyboardEvent,
} from 'react'
import type { LayerOption } from '../../types'
import { FloatingPopover } from '../../../../Timeline/lib'

export type LayerSelectProps = {
    /** Caption above the control. */
    label: string
    /** Chosen layer id, or null while the field is still on its placeholder. */
    value: string | null
    /** Layers offered in the list. */
    layers: LayerOption[]
    /** Wording the field carries while nothing is chosen. */
    placeholder: string
    onChange?: (layerId: string) => void
}

/**
 * A layer picker that draws its own list.
 *
 * A native select hands its list to the operating system, which renders it in
 * the platform's type and colour rather than the panel's, so the list is drawn
 * here on the same popover surface the layers list's menu uses. FloatingPopover
 * carries it, which keeps it clear of the panel's own scrolling box and gives
 * it dismissal and focus restoration.
 */
export function LayerSelect({
    label,
    value,
    layers,
    placeholder,
    onChange,
}: LayerSelectProps) {
    const [open, setOpen] = useState(false)
    // The list matches the field it drops from, which also squares it up under
    // the field: FloatingPopover centres on its anchor, and equal widths make
    // that flush.
    const [width, setWidth] = useState<number>()
    const triggerRef = useRef<HTMLButtonElement>(null)
    const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
    const listId = useId()
    const labelId = useId()

    const selectedIndex = layers.findIndex((layer) => layer.id === value)
    const selected = selectedIndex === -1 ? null : layers[selectedIndex]

    useLayoutEffect(() => {
        if (open) setWidth(triggerRef.current?.getBoundingClientRect().width)
    }, [open])

    const focusOption = (index: number) => {
        const count = layers.length
        if (count === 0) return
        // Arrowing past either end wraps, as the layers list's menu does.
        optionRefs.current[((index % count) + count) % count]?.focus()
    }

    // Opening moves focus onto an option, which is what arrowing then walks.
    // The list opens on the current choice, so the next key moves from there.
    const openAt = (index: number) => {
        setOpen(true)
        requestAnimationFrame(() => focusOption(index))
    }

    // Stable, so the popover's dismissal listeners are bound once per opening
    // rather than rebound on every render of the panel around it.
    const close = useCallback(() => setOpen(false), [])

    const onTriggerKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
        if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            openAt(selectedIndex === -1 ? 0 : selectedIndex)
        } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            openAt(selectedIndex === -1 ? layers.length - 1 : selectedIndex)
        }
    }

    const onOptionKeyDown = (
        e: KeyboardEvent<HTMLButtonElement>,
        index: number,
    ) => {
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault()
                focusOption(index + 1)
                break
            case 'ArrowUp':
                e.preventDefault()
                focusOption(index - 1)
                break
            case 'Home':
                e.preventDefault()
                focusOption(0)
                break
            case 'End':
                e.preventDefault()
                focusOption(layers.length - 1)
                break
            case 'Tab':
                // Tab leaves the field entirely rather than walking the list.
                close()
                break
        }
        // Escape is the popover's to handle, and Enter and Space need none —
        // a <button> raises click for both.
    }

    return (
        <div className="blocks-comparison__field">
            <span className="blocks-comparison__field-label" id={labelId}>
                {label}
            </span>
            <div className="blocks-comparison__select-wrapper">
                <button
                    ref={triggerRef}
                    type="button"
                    className={`blocks-comparison__select${
                        selected ? '' : ' blocks-comparison__select--placeholder'
                    }`}
                    role="combobox"
                    aria-haspopup="listbox"
                    aria-expanded={open}
                    aria-controls={open ? listId : undefined}
                    aria-labelledby={labelId}
                    onClick={() =>
                        open
                            ? close()
                            : openAt(selectedIndex === -1 ? 0 : selectedIndex)
                    }
                    onKeyDown={onTriggerKeyDown}
                >
                    {selected ? selected.title : placeholder}
                </button>
                <i
                    className={`mdi mdi-18px blocks-comparison__select-caret ${
                        open ? 'mdi-chevron-up' : 'mdi-chevron-down'
                    }`}
                />
            </div>
            <FloatingPopover
                anchorRef={triggerRef}
                isOpen={open}
                onClose={close}
                placement="bottom"
                offset={2}
                label={label}
            >
                <div
                    role="listbox"
                    id={listId}
                    aria-label={label}
                    className="blocks-comparison__options"
                    style={{ width }}
                >
                    {layers.map((layer, index) => (
                        <button
                            key={layer.id}
                            ref={(el) => {
                                optionRefs.current[index] = el
                            }}
                            type="button"
                            role="option"
                            aria-selected={layer.id === value}
                            className={`blocks-comparison__option${
                                layer.id === value
                                    ? ' blocks-comparison__option--selected'
                                    : ''
                            }`}
                            tabIndex={-1}
                            onClick={() => {
                                onChange?.(layer.id)
                                close()
                            }}
                            onKeyDown={(e) => onOptionKeyDown(e, index)}
                        >
                            {layer.title}
                        </button>
                    ))}
                </div>
            </FloatingPopover>
        </div>
    )
}
