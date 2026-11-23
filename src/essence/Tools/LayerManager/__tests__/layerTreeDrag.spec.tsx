import React, { act } from 'react'
import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { LayerManagerPanel } from '../lib/geo/LayerManagerPanel/LayerManagerPanel'
import { buildLayerList } from '../lib/utils/layerTree'
import type { GroupInfo, Layer, LayerStructureNode } from '../lib/types'
import { mount, type Mounted } from '../../_shared/__tests__/reactHarness'

/**
 * Drags through the mounted list, by keyboard, from pick-up to drop: which
 * row an arrow key steps to, and what the list hands `onMove`.
 *
 * jsdom lays nothing out, so each row is given a box: 40px per row in
 * document order, a group's box spanning its header and every row under it,
 * as the browser draws them.
 */

const layer = (id: string): Layer => ({
    id,
    title: id.toUpperCase(),
    description: null,
    opacity: 1,
    visible: true,
    type: 'none',
    cog: null,
})

// aq
//   aqs
//     pm
//     o3
//   fc
// base
const STRUCTURE: LayerStructureNode[] = [
    {
        kind: 'group',
        id: 'aq',
        children: [
            {
                kind: 'group',
                id: 'aqs',
                children: [
                    { kind: 'layer', id: 'pm' },
                    { kind: 'layer', id: 'o3' },
                ],
            },
            { kind: 'layer', id: 'fc' },
        ],
    },
    { kind: 'layer', id: 'base' },
]

const GROUPS: Record<string, GroupInfo> = {
    aq: { title: 'Air Quality', expanded: true },
    aqs: { title: 'AQS', expanded: true },
}

const ROW = 40
const ITEM = '.blocks-layer-legend-list__item'

const boxOf = (item: Element): DOMRect => {
    const items = Array.from(document.querySelectorAll(ITEM))
    const top = items.indexOf(item) * ROW
    const height = ROW * (1 + item.querySelectorAll(ITEM).length)
    return {
        x: 0,
        y: top,
        top,
        left: 0,
        right: 300,
        bottom: top + height,
        width: 300,
        height,
        toJSON: () => ({}),
    }
}

let mounted: Mounted | null = null

beforeEach(() => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
        this: Element,
    ) {
        const item = this.closest(ITEM)
        return item ? boxOf(item) : boxOf(document.body)
    })
})

afterEach(async () => {
    await mounted?.unmount()
    mounted = null
    vi.restoreAllMocks()
})

const render = async (onMove: () => void) => {
    const rows = ['pm', 'o3', 'fc', 'base'].map(layer)
    mounted = await mount(
        <LayerManagerPanel
            layers={rows}
            nodes={buildLayerList(rows, STRUCTURE, GROUPS)}
            onMove={onMove}
        />,
    )
}

const handleOf = (title: string) =>
    document.querySelector(`[title="Drag to reorder ${title}"]`) as HTMLElement

const key = async (target: EventTarget, code: string) => {
    await act(async () => {
        target.dispatchEvent(new KeyboardEvent('keydown', { code, key: code, bubbles: true }))
        // The sensor measures and moves on the next frames.
        await new Promise((resolve) => setTimeout(resolve, 20))
    })
}

/** Picks up the row titled `title`, presses each arrow, and drops. */
const keyboardDrag = async (title: string, arrows: string[]) => {
    const handle = handleOf(title)
    handle.focus()
    await key(handle, 'Space')
    for (const arrow of arrows) await key(handle, arrow)
    await key(handle, 'Space')
}

describe('LayerTreeList keyboard drag', () => {
    test('a layer steps to the sibling above it within its group', async () => {
        const onMove = vi.fn()
        await render(onMove)
        await keyboardDrag('O3', ['ArrowUp'])
        expect(onMove).toHaveBeenCalledWith('o3', 'pm', 'before')
    })

    test('a layer below a group steps onto the group, not into its rows', async () => {
        const onMove = vi.fn()
        await render(onMove)
        await keyboardDrag('FC', ['ArrowUp'])
        expect(onMove).toHaveBeenCalledWith('fc', 'aqs', 'before')
    })

    test('a top-level layer steps past an open group in one press', async () => {
        const onMove = vi.fn()
        await render(onMove)
        await keyboardDrag('BASE', ['ArrowUp'])
        expect(onMove).toHaveBeenCalledWith('base', 'aq', 'before')
    })

    test('a group moves among its own siblings only', async () => {
        const onMove = vi.fn()
        await render(onMove)
        await keyboardDrag('AQS', ['ArrowDown'])
        expect(onMove).toHaveBeenCalledWith('aqs', 'fc', 'after')
    })

    test('a drop where it started moves nothing', async () => {
        const onMove = vi.fn()
        await render(onMove)
        await keyboardDrag('PM', ['ArrowUp'])
        expect(onMove).not.toHaveBeenCalled()
    })
})
