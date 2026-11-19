import React from 'react'
import { ChevronRight } from '../../icons/Chevron'
import './LayerGroupSidebarItem.css'

/** Indent per level of nesting, shared with the layer rows beneath a group. */
export const GROUP_INDENT = 12

export interface LayerGroupSidebarItemProps {
    id: string
    displayName: string
    /** How deeply the group is nested; 0 at the top level. */
    depth: number
    collapsed: boolean
    /** The row pitch, shared with the chart row drawn beside it. */
    height: number
    onToggle: (id: string) => void
}

/**
 * A layer group's row in the sidebar. The whole row is one button that folds
 * the group's layers away or brings them back; the chevron points right while
 * folded and down while open.
 */
export const LayerGroupSidebarItem: React.FC<LayerGroupSidebarItemProps> = ({
    id,
    displayName,
    depth,
    collapsed,
    height,
    onToggle,
}) => (
    <button
        type="button"
        className="layer-group-item"
        style={{ height, flexShrink: 0, paddingLeft: 6 + depth * GROUP_INDENT }}
        aria-expanded={!collapsed}
        title={displayName}
        onClick={() => onToggle(id)}
    >
        <span
            className={`layer-group-chevron${collapsed ? '' : ' is-open'}`}
        >
            <ChevronRight />
        </span>
        <span className="layer-group-name">{displayName}</span>
    </button>
)
