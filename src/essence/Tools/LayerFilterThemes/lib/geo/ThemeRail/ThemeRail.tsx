import React, { useRef, useState } from 'react'
import type { ThemeSummary } from '../../types'

/** Icon names come from hand-authored config; strip anything that isn't a
 *  plain MDI name so a stray space can't inject extra classes. */
function iconClass(icon: string): string {
    return icon.toLowerCase().replace(/[^a-z0-9-]/g, '')
}

export interface ThemeRailProps {
    themes: ThemeSummary[]
    selectedId: string
    onSelect: (id: string) => void
}

/** Presentational green rail: one entry per theme. Toggle buttons (not ARIA
 *  tabs — the panel they drive is a separate plugin, so a tab→tabpanel
 *  relationship can't be wired) with a roving tabindex: arrow keys only move
 *  focus to browse, Enter/Space/click selects. */
export function ThemeRail({ themes, selectedId, onSelect }: ThemeRailProps) {
    const [focusedId, setFocusedId] = useState<string | null>(null)
    const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({})

    // The one Tab stop: the last arrow-focused item while browsing, else the
    // selected theme (else the first) — so Tab enters at the selection and a
    // single Tab leaves the rail.
    const tabbableId =
        focusedId ??
        (themes.some((t) => t.id === selectedId) ? selectedId : themes[0]?.id)

    const focusItem = (id: string) => {
        setFocusedId(id)
        itemRefs.current[id]?.focus()
    }

    const onKeyDown = (event: React.KeyboardEvent, id: string) => {
        if (!themes.length) return
        const index = themes.findIndex((t) => t.id === id)
        const count = themes.length
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault()
                focusItem(themes[(index + 1) % count].id)
                break
            case 'ArrowUp':
                event.preventDefault()
                focusItem(themes[(index - 1 + count) % count].id)
                break
            case 'Home':
                event.preventDefault()
                focusItem(themes[0].id)
                break
            case 'End':
                event.preventDefault()
                focusItem(themes[count - 1].id)
                break
        }
    }

    return (
        <div
            className="blocks-theme-rail"
            role="group"
            aria-label="Filter themes"
            onBlur={(event) => {
                // Focus left the rail: forget the browse position so the next
                // Tab re-enters at the selected theme.
                if (!event.currentTarget.contains(event.relatedTarget as Node))
                    setFocusedId(null)
            }}
        >
            {themes.map((theme) => {
                const active = theme.id === selectedId
                return (
                    <button
                        key={theme.id}
                        ref={(el) => {
                            itemRefs.current[theme.id] = el
                        }}
                        type="button"
                        aria-pressed={active}
                        tabIndex={theme.id === tabbableId ? 0 : -1}
                        className={`blocks-theme-rail__item${
                            active ? ' blocks-theme-rail__item--active' : ''
                        }`}
                        onClick={() => onSelect(theme.id)}
                        onKeyDown={(event) => onKeyDown(event, theme.id)}
                    >
                        {theme.icon && (
                            <i
                                className={`mdi mdi-${iconClass(theme.icon)} blocks-theme-rail__icon`}
                                aria-hidden="true"
                            />
                        )}
                        <span className="blocks-theme-rail__label">{theme.label}</span>
                    </button>
                )
            })}
        </div>
    )
}
