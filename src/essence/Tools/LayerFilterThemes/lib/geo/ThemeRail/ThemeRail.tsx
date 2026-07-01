import React from 'react'
import type { ThemeSummary } from '../../types'

export interface ThemeRailProps {
    themes: ThemeSummary[]
    selectedId: string
    onSelect: (id: string) => void
    /** The chevron button at the top of the rail. */
    onTopButtonClick?: () => void
}

/** Presentational green rail: a top chevron button + one entry per theme. */
export function ThemeRail({
    themes,
    selectedId,
    onSelect,
    onTopButtonClick,
}: ThemeRailProps) {
    return (
        <div
            className="blocks-theme-rail"
            role="tablist"
            aria-orientation="vertical"
            aria-label="Filter themes"
        >
            <button
                type="button"
                className="blocks-theme-rail__top"
                aria-label="Collapse panel"
                onClick={() => onTopButtonClick?.()}
            >
                <i
                    className="mdi mdi-chevron-right blocks-theme-rail__top-icon"
                    aria-hidden="true"
                />
            </button>

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
                                className={`mdi mdi-${theme.icon} blocks-theme-rail__icon`}
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
