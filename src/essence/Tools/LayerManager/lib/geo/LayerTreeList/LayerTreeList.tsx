import React, {
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
    type ReactNode,
} from 'react'
import {
    DndContext,
    KeyboardSensor,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
    type CollisionDetection,
    type DragEndEvent,
} from '@dnd-kit/core'
import {
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
    LayerLegend,
    hasText,
    renderAsPlainText,
    type DragHandleProps,
    type LayerLegendProps,
    type RenderDescription,
} from '../LayerLegend/LayerLegend'
import type { LayerLegendListProps } from '../LayerLegendList/LayerLegendList'
import { FloatingPopover } from '../../FloatingPopover'
import type { LayerGroup, LayerListNode } from '../../types'
import {
    nodeId,
    resolveDrop,
    treeAnnouncements,
    type Placement,
} from '../../utils/layerTree'

type RowProps = Omit<LayerLegendProps, 'layer' | 'dragHandle'>

export type LayerTreeListProps = Omit<LayerLegendListProps, 'layers' | 'onReorder'> & {
    nodes: LayerListNode[]
    /**
     * An item was dropped just before or after `overId`, its sibling. Items
     * drag only with it, and only among their siblings.
     */
    onMove?: (id: string, overId: string, placement: Placement) => void
} & GroupHandlers

type GroupHandlers = {
    /** The group's on/off switch was flipped; no handler, no switch. */
    onGroupVisibilityChange?: (groupId: string, visible: boolean) => void
}

type GroupProps = {
    group: LayerGroup
    collapsed: boolean
    onToggleCollapsed: (groupId: string, collapsed: boolean) => void
    dragHandle?: DragHandleProps
    handlers: GroupHandlers
    renderDescription?: RenderDescription
    children: ReactNode
}

function GroupView({
    group,
    collapsed,
    onToggleCollapsed,
    dragHandle,
    handlers: { onGroupVisibilityChange },
    renderDescription = renderAsPlainText,
    children,
}: GroupProps) {
    const childrenId = useId()
    const infoPopoverId = useId()
    const infoBtnRef = useRef<HTMLButtonElement | null>(null)

    // Follows the host, and shows a change at once until it answers.
    const [isVisible, setIsVisible] = useState(group.visible === true)
    useEffect(() => setIsVisible(group.visible === true), [group.visible])
    // Mixed only while the host agrees the group is on, so a click shows its
    // result at once rather than a stale dash.
    const isPartial = isVisible && group.visible === true && group.partial === true
    const checkboxRef = useRef<HTMLInputElement | null>(null)
    // Mixed is a property with no attribute, so it is set on the element.
    useEffect(() => {
        if (checkboxRef.current) checkboxRef.current.indeterminate = isPartial
    }, [isPartial])

    const [isInfoOpen, setIsInfoOpen] = useState(false)
    const closeInfo = useCallback(() => setIsInfoOpen(false), [])
    const hasDescription = hasText(group.description)

    const handleVisibilityToggle = () => {
        const next = !isVisible
        setIsVisible(next)
        onGroupVisibilityChange?.(group.id, next)
    }

    return (
        <div
            className={`blocks-layer-tree__group ${isInfoOpen ? 'blocks-layer-tree__group--open' : ''}`}
            data-group-id={group.id}
        >
            <div className="blocks-layer-tree__group-header">
                {dragHandle && (
                    <button
                        ref={dragHandle.ref}
                        type="button"
                        className="blocks-layer-legend__action-btn blocks-layer-legend__drag-handle"
                        title={`Drag to reorder ${group.title}`}
                        {...dragHandle.attributes}
                        {...dragHandle.listeners}
                    >
                        <span className="blocks-layer-legend__icon blocks-layer-legend__icon--drag-handle" />
                    </button>
                )}
                <button
                    type="button"
                    className="blocks-layer-tree__chevron"
                    onClick={() => onToggleCollapsed(group.id, !collapsed)}
                    aria-expanded={!collapsed}
                    aria-controls={collapsed ? undefined : childrenId}
                    title={`${collapsed ? 'Expand' : 'Collapse'} ${group.title}`}
                >
                    <i
                        className={`mdi mdi-chevron-${collapsed ? 'right' : 'down'}`}
                        aria-hidden="true"
                    />
                </button>
                {onGroupVisibilityChange && (
                    <div className="blocks-layer-legend__checkbox-wrapper">
                        <input
                            ref={checkboxRef}
                            type="checkbox"
                            className="blocks-layer-legend__checkbox"
                            checked={isVisible}
                            onChange={handleVisibilityToggle}
                            aria-label={`Show all layers in ${group.title}`}
                            title={
                                isPartial
                                    ? `Some layers in ${group.title} are on. Turn them off`
                                    : isVisible
                                      ? `Turn off every layer in ${group.title}`
                                      : `Turn ${group.title} back on`
                            }
                        />
                    </div>
                )}
                <span className="blocks-layer-tree__group-title" title={group.title}>
                    {group.title}
                </span>
                <div className="blocks-layer-tree__actions">
                    {/* Disabled through aria, as on a layer row, so its title
                        still says why it does nothing. */}
                    <button
                        ref={infoBtnRef}
                        type="button"
                        className={[
                            'blocks-layer-legend__action-btn',
                            !hasDescription ? 'blocks-layer-legend__action-btn--disabled' : '',
                            isInfoOpen ? 'blocks-layer-legend__action-btn--active' : '',
                        ]
                            .filter(Boolean)
                            .join(' ')}
                        onClick={() => hasDescription && setIsInfoOpen((open) => !open)}
                        aria-disabled={!hasDescription}
                        aria-haspopup={hasDescription ? 'dialog' : undefined}
                        aria-expanded={hasDescription ? isInfoOpen : undefined}
                        aria-controls={isInfoOpen ? infoPopoverId : undefined}
                        title={
                            hasDescription
                                ? isInfoOpen
                                    ? 'Hide info'
                                    : 'Show info'
                                : 'No description available'
                        }
                    >
                        <span className="blocks-layer-legend__icon blocks-layer-legend__icon--info" />
                    </button>
                </div>
            </div>
            {hasDescription && (
                <FloatingPopover
                    id={infoPopoverId}
                    anchorRef={infoBtnRef}
                    isOpen={isInfoOpen}
                    onClose={closeInfo}
                    placement="bottom"
                    offset={6}
                    className="blocks-layer-legend__info-popover"
                    label={`Information for ${group.title}`}
                >
                    <div className="blocks-layer-legend__info-title">{group.title}</div>
                    {renderDescription(group.description as string, 'blocks-layer-legend__markdown')}
                </FloatingPopover>
            )}
            {!collapsed && (
                <div
                    id={childrenId}
                    className="blocks-layer-tree__children"
                    role="group"
                    aria-label={group.title}
                >
                    {children}
                </div>
            )}
        </div>
    )
}

type LevelProps = {
    nodes: LayerListNode[]
    parentId: string | null
    rowProps: RowProps
    handlers: GroupHandlers
    collapsed: (group: LayerGroup) => boolean
    onToggleCollapsed: (groupId: string, collapsed: boolean) => void
}

/** One level of a list that cannot be reordered. */
function PlainLevel({ nodes, ...rest }: LevelProps) {
    return (
        <>
            {nodes.map((node) =>
                node.kind === 'layer' ? (
                    <LayerLegend key={node.layer.id} layer={node.layer} {...rest.rowProps} />
                ) : (
                    <GroupView
                        key={node.group.id}
                        group={node.group}
                        collapsed={rest.collapsed(node.group)}
                        onToggleCollapsed={rest.onToggleCollapsed}
                        handlers={rest.handlers}
                        renderDescription={rest.rowProps.renderDescription}
                    >
                        <PlainLevel {...rest} nodes={node.group.children} parentId={node.group.id} />
                    </GroupView>
                ),
            )}
        </>
    )
}

function SortableNode({ node, ...rest }: Omit<LevelProps, 'nodes'> & { node: LayerListNode }) {
    const id = nodeId(node)
    const {
        attributes,
        listeners,
        setNodeRef,
        setActivatorNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id, data: { parentId: rest.parentId } })
    // Copied into a plain record: DraggableAttributes has no index signature,
    // and the row components stay free of the library's types.
    const dragHandle = { ref: setActivatorNodeRef, attributes: { ...attributes }, listeners }
    return (
        <div
            ref={setNodeRef}
            className={`blocks-layer-legend-list__item ${isDragging ? 'blocks-layer-legend-list__item--dragging' : ''}`}
            style={{ transform: CSS.Translate.toString(transform), transition }}
        >
            {node.kind === 'layer' ? (
                <LayerLegend layer={node.layer} {...rest.rowProps} dragHandle={dragHandle} />
            ) : (
                <GroupView
                    group={node.group}
                    collapsed={rest.collapsed(node.group)}
                    onToggleCollapsed={rest.onToggleCollapsed}
                    dragHandle={dragHandle}
                    handlers={rest.handlers}
                    renderDescription={rest.rowProps.renderDescription}
                >
                    <SortableLevel {...rest} nodes={node.group.children} parentId={node.group.id} />
                </GroupView>
            )}
        </div>
    )
}

/** One level of a reorderable list: its own sortable context of siblings. */
function SortableLevel({ nodes, ...rest }: LevelProps) {
    return (
        <SortableContext items={nodes.map(nodeId)} strategy={verticalListSortingStrategy}>
            {nodes.map((node) => (
                <SortableNode key={nodeId(node)} node={node} {...rest} />
            ))}
        </SortableContext>
    )
}

/**
 * Collision only with the dragged item's siblings, so a layer never hovers
 * over another group's rows and a group never leaves its level.
 */
const siblingsOnly: CollisionDetection = (args) => {
    const parent = args.active.data.current?.parentId ?? null
    return closestCenter({
        ...args,
        droppableContainers: args.droppableContainers.filter(
            (container) => (container.data.current?.parentId ?? null) === parent,
        ),
    })
}

export function LayerTreeList({
    nodes,
    emptyMessage = 'No layers with legends are currently visible.',
    onMove,
    onGroupVisibilityChange,
    ...rowProps
}: LayerTreeListProps) {
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    )
    const announcements = useMemo(() => treeAnnouncements(nodes ?? []), [nodes])

    // A group starts as its header is configured, collapsed unless marked
    // expanded. Once folded or unfolded by hand it stays that way across
    // refreshes; choices are held by group id.
    const [chosen, setChosen] = useState<Map<string, boolean>>(() => new Map())
    const onToggleCollapsed = useCallback((groupId: string, next: boolean) => {
        setChosen((current) => new Map(current).set(groupId, next))
    }, [])
    const collapsed = useCallback(
        (group: LayerGroup) => chosen.get(group.id) ?? group.expanded !== true,
        [chosen],
    )

    if (!nodes || nodes.length === 0) {
        return (
            <div className="blocks-layer-legend-list">
                <div className="blocks-layer-legend-list__empty">{emptyMessage}</div>
            </div>
        )
    }

    const handlers = { onGroupVisibilityChange }
    const level = { nodes, parentId: null, rowProps, handlers, collapsed, onToggleCollapsed }

    if (!onMove) {
        return (
            <div className="blocks-layer-legend-list blocks-layer-tree">
                <PlainLevel {...level} />
            </div>
        )
    }

    const handleDragEnd = ({ active, over }: DragEndEvent) => {
        const activeId = String(active.id)
        const overId = over == null ? null : String(over.id)
        const placement = resolveDrop(nodes, activeId, overId)
        if (placement && overId) onMove(activeId, overId, placement)
    }

    return (
        <div className="blocks-layer-legend-list blocks-layer-tree">
            <DndContext
                sensors={sensors}
                collisionDetection={siblingsOnly}
                accessibility={{ announcements }}
                onDragEnd={handleDragEnd}
            >
                <SortableLevel {...level} />
            </DndContext>
        </div>
    )
}
