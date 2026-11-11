import { describe, test, expect } from 'vitest'
import { siblingKeyboardCoordinates } from '../lib/geo/LayerTreeList/LayerTreeList'

/**
 * The keyboard stepper on a list laid out top to bottom as:
 *   a        (top level, being dragged)
 *   g        (top-level group, open)
 *     g1, g2 (g's children)
 *   b        (top level)
 */

class Containers extends Map<string, any> {
    get(id: string) {
        return super.get(id)
    }
    getEnabled() {
        return Array.from(this.values()).filter((c) => !c.disabled)
    }
}

const ROWS: Array<[string, string | null, number, number]> = [
    ['a', null, 0, 40],
    ['g', null, 40, 160],
    ['g1', 'g', 80, 120],
    ['g2', 'g', 120, 160],
    ['b', null, 160, 200],
]

const rect = (top: number, bottom: number) => ({
    top,
    bottom,
    left: 0,
    right: 200,
    width: 200,
    height: bottom - top,
})

const context = (collisionTop: number, overId: string | null) => {
    const containers = new Containers()
    const rects = new Map()
    for (const [id, parentId, top, bottom] of ROWS) {
        containers.set(id, {
            id,
            disabled: false,
            data: { current: { parentId } },
            node: { current: document.createElement('div') },
        })
        rects.set(id, rect(top, bottom))
    }
    return {
        active: { id: 'a', data: { current: { parentId: null } } },
        collisionRect: rect(collisionTop, collisionTop + 40),
        droppableRects: rects,
        droppableContainers: containers,
        over: overId ? { id: overId } : null,
        scrollableAncestors: [],
    }
}

const step = (collisionTop: number, overId: string | null) =>
    siblingKeyboardCoordinates(
        { code: 'ArrowDown', preventDefault: () => {} } as unknown as KeyboardEvent,
        { active: 'a', currentCoordinates: { x: 0, y: collisionTop }, context: context(collisionTop, overId) } as any,
    )

describe('siblingKeyboardCoordinates', () => {
    test('steps a top-level layer onto the group beside it', () => {
        expect(step(0, 'a')).toEqual({ x: 0, y: 40 })
    })

    test('steps past the group to the next sibling, not into its rows', () => {
        expect(step(40, 'g')).toEqual({ x: 0, y: 160 })
    })
})
