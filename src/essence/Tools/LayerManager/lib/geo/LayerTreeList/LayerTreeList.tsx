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
    pointerWithin,
    useSensor,
    useSensors,
    type CollisionDetection,
    type DragEndEvent,
    type KeyboardCoordinateGetter,
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
import { FloatingPopover } from '../../FloatingPopover'
import type { LayerGroup, LayerListNode } from '../../types'
import {
    nodeId,
    resolveDrop,
    treeAnnouncements,
    type Placement,
} from '../../utils/layerTree'

type RowProps = Omit<LayerLegendProps, 'layer' | 'dragHandle'>

export type LayerTreeListProps = RowProps & {
    nodes: LayerListNode[]
    emptyMessage?: string
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
    /** Rows carry drag handles only when moves are handled. */
    draggable: boolean
    rowProps: RowProps
    handlers: GroupHandlers
    collapsed: (group: LayerGroup) => boolean
    onToggleCollapsed: (groupId: string, collapsed: boolean) => void
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
    } = useSortable({ id, data: { parentId: rest.parentId }, disabled: !rest.draggable })
    // Copied into a plain record: DraggableAttributes has no index signature,
    // and the row components stay free of the library's types.
    const dragHandle = rest.draggable
        ? { ref: setActivatorNodeRef, attributes: { ...attributes }, listeners }
        : undefined
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

/** One level of the list: its own sortable context of siblings. */
function SortableLevel({ nodes, ...rest }: LevelProps) {
    return (
        <SortableContext items={nodes.map(nodeId)} strategy={verticalListSortingStrategy}>
            {nodes.map((node) => (
                <SortableNode key={nodeId(node)} node={node} {...rest} />
            ))}
        </SortableContext>
    )
}

type WithParent = { data: { current?: { parentId?: string | null } | null } }

/** The group an item sits in; null at the top level. */
const parentOf = (item: WithParent | null): string | null =>
    item?.data.current?.parentId ?? null

/**
 * The point that picks the drop target: the pointer, or for a keyboard drag
 * the edge leading the move, which the arrow keys line up with the target's.
 */
type CollisionArgs = Parameters<CollisionDetection>[0]

const probePoint = (args: CollisionArgs): { x: number; y: number } | null => {
    const { active, collisionRect, droppableRects, pointerCoordinates } = args
    if (pointerCoordinates) return pointerCoordinates
    const start = droppableRects.get(active.id)
    if (!start || collisionRect.top === start.top) return null
    const x = collisionRect.left + collisionRect.width / 2
    return collisionRect.top < start.top
        ? { x, y: collisionRect.top + 1 }
        : { x, y: collisionRect.top + collisionRect.height - 1 }
}

/**
 * The drop target among the dragged item's siblings only, so a layer never
 * targets another group's rows and a group never leaves its level. The
 * sibling under the probe point wins: a group's box spans all its rows, so
 * nearest-centre would put the target in the middle of an open group rather
 * than at its header. Nearest-centre decides when the point is over none.
 */
export const siblingsOnly: CollisionDetection = (args) => {
    const parent = parentOf(args.active)
    const siblings = {
        ...args,
        droppableContainers: args.droppableContainers.filter(
            (container) => parentOf(container) === parent,
        ),
    }
    const point = probePoint(args)
    const under = point ? pointerWithin({ ...siblings, pointerCoordinates: point }) : []
    return under.length > 0 ? under : closestCenter(siblings)
}

/**
 * Arrow keys step the dragged item from sibling to sibling. The sortable
 * stepper picks the next row among every row on screen, which would walk a
 * layer through each row of a neighbouring group while its drop stays beside
 * that group, and walk a group onto its own children.
 */
export const siblingKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
    const { active, droppableContainers: all } = args.context
    const parent = parentOf(active)
    // Same map type, so the stepper's lookups work on it unchanged.
    const Containers = all.constructor as new (entries: Iterable<[unknown, unknown]>) => typeof all
    const siblings = new Containers(
        Array.from(all.entries()).filter(([, container]) => parentOf(container) === parent),
    )
    return sortableKeyboardCoordinates(event, {
        ...args,
        context: { ...args.context, droppableContainers: siblings },
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
        useSensor(KeyboardSensor, { coordinateGetter: siblingKeyboardCoordinates }),
    )
    const announcements = useMemo(() => treeAnnouncements(nodes), [nodes])

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

    if (nodes.length === 0) {
        return (
            <div className="blocks-layer-legend-list">
                <div className="blocks-layer-legend-list__empty">{emptyMessage}</div>
            </div>
        )
    }

    const handleDragEnd = ({ active, over }: DragEndEvent) => {
        const activeId = String(active.id)
        const overId = over == null ? null : String(over.id)
        const placement = resolveDrop(nodes, activeId, overId)
        if (placement && overId) onMove?.(activeId, overId, placement)
    }

    // Only a list holding a group lines its rows up in the tree's columns; a
    // flat list keeps the plain row layout.
    const grouped = nodes.some((node) => node.kind === 'group')

    return (
        <div className={`blocks-layer-legend-list ${grouped ? 'blocks-layer-tree' : ''}`}>
            <DndContext
                sensors={sensors}
                collisionDetection={siblingsOnly}
                accessibility={{ announcements }}
                onDragEnd={handleDragEnd}
            >
                <SortableLevel
                    nodes={nodes}
                    parentId={null}
                    draggable={onMove != null}
                    rowProps={rowProps}
                    handlers={{ onGroupVisibilityChange }}
                    collapsed={collapsed}
                    onToggleCollapsed={onToggleCollapsed}
                />
            </DndContext>
        </div>
    )
}
