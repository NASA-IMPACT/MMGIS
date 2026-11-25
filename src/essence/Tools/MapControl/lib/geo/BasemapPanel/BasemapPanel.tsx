import React, { useEffect, useRef } from 'react'
import type { BasemapGroup, BasemapGroupState, BasemapStyle } from '../../types'
import { basemapGradient } from '../../utils/basemap'

export type BasemapPanelProps = {
    /** All selectable basemap styles. */
    styles: BasemapStyle[]
    /** Currently-active style, used to mark the selected row. */
    active: BasemapStyle | null
    /** Called when a style row is chosen. */
    onSelect: (style: BasemapStyle) => void
    /** Named layer groups, one checkbox each, a parent's children indented
     *  under it; empty leaves them out. */
    groups?: BasemapGroup[]
    onToggleGroup?: (id: string, visible: boolean) => void
}

export function BasemapPanel({
    styles,
    active,
    onSelect,
    groups = [],
    onToggleGroup,
}: BasemapPanelProps) {
    return (
        <div className="blocks-basemap-panel">
            <div className="blocks-basemap-panel__header">
                <span>Basemap style</span>
            </div>
            {groups.length > 0 && onToggleGroup && (
                <div className="blocks-basemap-panel__groups">
                    {groups.map((group) =>
                        group.children ? (
                            <div key={group.id} className="blocks-basemap-panel__group">
                                <GroupCheckbox group={group} onToggle={onToggleGroup} />
                                <div className="blocks-basemap-panel__children">
                                    {group.children.map((child) => (
                                        <GroupCheckbox key={child.id} group={child} onToggle={onToggleGroup} />
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <GroupCheckbox key={group.id} group={group} onToggle={onToggleGroup} />
                        ),
                    )}
                </div>
            )}
            {styles.map((entry) => {
                const isActive = active?.name === entry.name
                return (
                    <button
                        key={entry.name}
                        type="button"
                        className={`blocks-basemap-panel__row${isActive ? ' blocks-basemap-panel__row--active' : ''}`}
                        onClick={() => onSelect(entry)}
                    >
                        <span className="blocks-basemap-panel__label">{entry.name}</span>
                        <span
                            className={`blocks-basemap-panel__thumb${isActive ? ' blocks-basemap-panel__thumb--active' : ''}`}
                            style={{ background: basemapGradient(entry.name) }}
                        />
                    </button>
                )
            })}
        </div>
    )
}

/**
 * One group's or child's checkbox. A mixed one shows half-checked; clicking
 * it turns every layer on, a parent's children's included.
 */
function GroupCheckbox({
    group,
    onToggle,
}: {
    group: BasemapGroupState
    onToggle: (id: string, visible: boolean) => void
}) {
    const ref = useRef<HTMLInputElement>(null)
    useEffect(() => {
        if (ref.current) ref.current.indeterminate = group.state === 'mixed'
    }, [group.state])
    return (
        <label className="blocks-basemap-panel__group-label">
            <input
                ref={ref}
                type="checkbox"
                checked={group.state === 'on'}
                onChange={() => onToggle(group.id, group.state !== 'on')}
            />
            {group.name}
        </label>
    )
}
