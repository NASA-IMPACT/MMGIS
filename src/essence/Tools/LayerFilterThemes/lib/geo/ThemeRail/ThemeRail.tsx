import React from 'react'
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

/** Presentational green rail: one entry per theme. */
export function ThemeRail({ themes, selectedId, onSelect }: ThemeRailProps) {
    return (
        <div
            className="blocks-theme-rail"
            role="tablist"
            aria-orientation="vertical"
            aria-label="Filter themes"
        >
            {themes.map((theme) => {
                const active = theme.id === selectedId
                return (
                    <button
                        key={theme.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        className={`blocks-theme-rail__item${
                            active ? ' blocks-theme-rail__item--active' : ''
                        }`}
                        onClick={() => onSelect(theme.id)}
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
