import { describe, test, expect } from 'vitest'
import {
    siblingKeyboardCoordinates,
    siblingsOnly,
} from '../lib/geo/LayerTreeList/LayerTreeList'

/**
 * The list's drag helpers on a fixed layout, top to bottom:
 *
 *   a         0–40    top level
 *   g        40–160   top-level group, open: its box spans its rows
 *     g1     80–120
 *     g2    120–160
 *   b       160–200   top level
 *
 * Each row carries the sortable data dnd-kit gives it: its container (one
 * per level) and its index there.
 */

type Row = [id: string, parentId: string | null, index: number, top: number, bottom: number]

const ROWS: Row[] = [
    ['a', null, 0, 0, 40],
    ['g', null, 1, 40, 160],
    ['g1', 'g', 0, 80, 120],
    ['g2', 'g', 1, 120, 160],
    ['b', null, 2, 160, 200],
]

const rect = (top: number, bottom: number) => ({
    top,
    bottom,
    left: 0,
    right: 200,
    width: 200,
    height: bottom - top,
})

/** The containers map dnd-kit hands its helpers: a Map with lookups. */
class Containers extends Map<string, unknown> {
    getEnabled() {
        return Array.from(this.values())
    }
}

const data = (parentId: string | null, index: number) => ({
    current: { parentId, sortable: { containerId: parentId ?? 'top', index, items: [] } },
})

const layout = () => {
    const containers = new Containers()
    const rects = new Map<string, ReturnType<typeof rect>>()
    for (const [id, parentId, index, top, bottom] of ROWS) {
        containers.set(id, {
            id,
            disabled: false,
            data: data(parentId, index),
            node: { current: document.createElement('div') },
            rect: { current: null },
        })
        rects.set(id, rect(top, bottom))
    }
    return { containers, rects }
}

const activeOf = (id: string) => {
    const [, parentId, index] = ROWS.find((row) => row[0] === id)!
    return { id, data: data(parentId, index), rect: { current: { initial: null, translated: null } } }
}

/** Where one arrow press moves the dragged item from its start. */
const step = (id: string, code: 'ArrowUp' | 'ArrowDown') => {
    const { containers, rects } = layout()
    const start = rects.get(id)!
    return siblingKeyboardCoordinates(
        { code, preventDefault: () => {} } as unknown as KeyboardEvent,
        {
            active: id,
            currentCoordinates: { x: 0, y: start.top },
            context: {
                active: activeOf(id),
                collisionRect: start,
                droppableRects: rects,
                droppableContainers: containers,
                over: { id },
                scrollableAncestors: [],
            },
        } as never,
    )
}

/** The target picked for `id` dragged to `collisionTop`, optionally under a pointer at `pointerY`. */
const target = (id: string, collisionTop: number, pointerY?: number) => {
    const { containers, rects } = layout()
    const height = rects.get(id)!.height
    const hits = siblingsOnly({
        active: activeOf(id),
        collisionRect: rect(collisionTop, collisionTop + height),
        droppableRects: rects,
        droppableContainers: Array.from(containers.values()),
        pointerCoordinates: pointerY == null ? null : { x: 10, y: pointerY },
    } as never)
    return hits[0]?.id
}

describe('siblingKeyboardCoordinates', () => {
    test('Up from below a group steps onto the group, not its last row', () => {
        expect(step('b', 'ArrowUp')).toEqual({ x: 0, y: 40 })
    })

    test('Down from above a group steps past it to the next sibling', () => {
        const to = step('a', 'ArrowDown')
        // Bottom-aligned with the group, then onward from there.
        expect(to).toEqual({ x: 0, y: 120 })
    })
})

describe('siblingsOnly', () => {
    test('the pointer over an open group header targets the group', () => {
        // Nearest-centre would pick a: b's centre is closer to a's than to
        // the middle of the open group.
        expect(target('b', 30, 45)).toBe('g')
    })

    test("the pointer over a group's rows targets the group, never the rows", () => {
        expect(target('b', 130, 130)).toBe('g')
    })

    test('a nested row targets only its siblings', () => {
        expect(target('g1', 120, 130)).toBe('g2')
        expect(target('g1', 160, 170)).not.toBe('b')
    })

    test('a keyboard drag targets the sibling its leading edge lines up with', () => {
        // b stepped up to g's top: its top edge sits in g's header.
        expect(target('b', 40)).toBe('g')
        // a stepped down to g's bottom: its bottom edge sits in g.
        expect(target('a', 120)).toBe('g')
    })

    test('a keyboard drag that has not moved targets itself', () => {
        expect(target('a', 0)).toBe('a')
    })
})
