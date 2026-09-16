import React, { useRef, useState } from 'react'
import type { ThemeIcon, ThemeSummary } from '../../types'
import { CollapsePanelIcon } from './icons'

/** Icon names come from hand-authored config; strip anything that isn't a
 *  plain MDI name so a stray space can't inject extra classes. */
function iconClass(icon: string): string {
    return icon.toLowerCase().replace(/[^a-z0-9-]/g, '')
}

/**
 * A theme's icon.
 *
 * An image icon is painted as a CSS mask rather than an `<img>` or inline
 * markup. That buys two things at once: the icon takes its color from the
 * item, so one uploaded file serves both rail states (white on the dark rail,
 * ink on the selected item's white fill), and an uploaded SVG is never parsed
 * as a document, so script embedded in one cannot run.
 */
function ThemeIconMark({ icon }: { icon: ThemeIcon }) {
    if (icon.kind === 'mdi')
        return (
            <i
                className={`mdi mdi-${iconClass(icon.name)} blocks-theme-rail__icon`}
                aria-hidden="true"
            />
        )

    // CSS.escape isn't enough here — the value sits inside a url() in an inline
    // style, so quote it and drop the characters that could close the url().
    const src = icon.src.replace(/["'()\\\s]/g, encodeURIComponent)
    return (
        <span
            className="blocks-theme-rail__icon blocks-theme-rail__icon--image"
            style={{
                maskImage: `url("${src}")`,
                WebkitMaskImage: `url("${src}")`,
            }}
            aria-hidden="true"
        />
    )
}

export interface ThemeRailProps {
    themes: ThemeSummary[]
    selectedId: string
    onSelect: (id: string) => void
    /** Opens/closes the neighbouring panel. The chevron above the themes is
     *  drawn only when this is given — a rail with nothing to drive shows a
     *  control that would do nothing. */
    onToggleCollapse?: () => void
    /** Whether that panel is currently closed, which the chevron points at:
     *  inward to close it, outward to open it again. */
    collapsed?: boolean
}

/** Presentational dark rail: a chevron that opens/closes the neighbouring
 *  panel, then one entry per theme. The theme entries are toggle buttons (not
 *  ARIA tabs — the panel they drive is a separate plugin, so a tab→tabpanel
 *  relationship can't be wired) with a roving tabindex: arrow keys only move
 *  focus to browse, Enter/Space/click selects. */
export function ThemeRail({
    themes,
    selectedId,
    onSelect,
    onToggleCollapse,
    collapsed = false,
}: ThemeRailProps) {
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
        <div className="blocks-theme-rail">
            {onToggleCollapse && (
                <button
                    type="button"
                    className="blocks-theme-rail__collapse"
                    aria-label={collapsed ? 'Open panel' : 'Close panel'}
                    aria-expanded={!collapsed}
                    onClick={onToggleCollapse}
                >
                    <CollapsePanelIcon
                        className={`blocks-theme-rail__collapse-icon${
                            collapsed ? '' : ' blocks-theme-rail__collapse-icon--close'
                        }`}
                        aria-hidden="true"
                        focusable="false"
                    />
                </button>
            )}

            <div
                className="blocks-theme-rail__themes"
                role="group"
                aria-label="Filter themes"
                onBlur={(event) => {
                    // Focus left the themes: forget the browse position so the
                    // next Tab re-enters at the selected theme.
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
                            {theme.icon && <ThemeIconMark icon={theme.icon} />}
                            <span className="blocks-theme-rail__label">
                                {theme.label}
                            </span>
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
