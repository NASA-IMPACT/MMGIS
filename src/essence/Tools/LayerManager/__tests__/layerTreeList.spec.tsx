import React from 'react'
import { describe, test, expect, afterEach } from 'vitest'
import { LayerManagerPanel } from '../lib/geo/LayerManagerPanel/LayerManagerPanel'
import { buildLayerList } from '../lib/utils/layerTree'
import type { GroupInfo, Layer, LayerStructureNode } from '../lib/types'
import { mount, click, type Mounted } from '../../_shared/__tests__/reactHarness'

/**
 * The grouped list as a host embeds it: rows and a structure in, groups out,
 * with no host present. Drag behaviour is covered through the pure helpers in
 * tests/unit/layerTree.spec.js; these cases cover what renders.
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

const GROUPS: Record<string, GroupInfo> = {
    aq: {
        title: 'Air Quality',
        description: 'Surface monitors and the forecast.',
        expanded: true,
    },
    aqs: { title: 'AQS', expanded: true },
}

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

let mounted: Mounted | null = null

afterEach(async () => {
    await mounted?.unmount()
    mounted = null
})

const render = async (ids: string[], onMove?: () => void) => {
    const rows = ids.map(layer)
    mounted = await mount(
        <LayerManagerPanel
            layers={rows}
            nodes={buildLayerList(rows, STRUCTURE, GROUPS)}
            onMove={onMove}
        />,
    )
    return mounted.container
}

const groupTitles = (root: Element) =>
    Array.from(root.querySelectorAll('.blocks-layer-tree__group-title')).map(
        (el) => el.textContent,
    )

const rowIds = (root: Element) =>
    Array.from(root.querySelectorAll('[data-legend-id]')).map((el) =>
        el.getAttribute('data-legend-id'),
    )

const chevron = (root: Element, groupId: string) =>
    root.querySelector(
        `[data-group-id="${groupId}"] > .blocks-layer-tree__group-header .blocks-layer-tree__chevron`,
    )!

describe('LayerTreeList', () => {
    test('renders nested groups with their layers inside', async () => {
        const root = await render(['pm', 'o3', 'fc', 'base'])
        expect(groupTitles(root)).toEqual(['Air Quality', 'AQS'])
        const aqs = root.querySelector('[data-group-id="aqs"]')!
        expect(rowIds(aqs)).toEqual(['pm', 'o3'])
        expect(rowIds(root)).toEqual(['pm', 'o3', 'fc', 'base'])
    })

    test('collapsing a group hides its contents and expanding shows them again', async () => {
        const root = await render(['pm', 'o3', 'fc', 'base'])
        const toggle = chevron(root, 'aq')
        expect(toggle.getAttribute('aria-expanded')).toBe('true')

        await click(toggle)
        expect(chevron(root, 'aq').getAttribute('aria-expanded')).toBe('false')
        expect(rowIds(root)).toEqual(['base'])
        expect(groupTitles(root)).toEqual(['Air Quality'])

        await click(chevron(root, 'aq'))
        expect(rowIds(root)).toEqual(['pm', 'o3', 'fc', 'base'])
    })

    test('a collapsed group stays collapsed when the rows refresh', async () => {
        const root = await render(['pm', 'o3', 'fc', 'base'])
        await click(chevron(root, 'aqs'))
        const rows = ['pm', 'o3', 'fc', 'base'].map(layer)
        await mounted!.rerender(
            <LayerManagerPanel layers={rows} nodes={buildLayerList(rows, STRUCTURE, GROUPS)} />,
        )
        expect(rowIds(root)).toEqual(['fc', 'base'])
    })

    test('a group with no rows to show is not rendered', async () => {
        const root = await render(['fc', 'base'])
        expect(groupTitles(root)).toEqual(['Air Quality'])
    })

    test('group headers carry a drag handle only when moves are handled', async () => {
        const plain = await render(['pm', 'base'])
        expect(plain.querySelector('[title="Drag to reorder Air Quality"]')).toBeNull()
        await mounted!.unmount()

        const sortable = await render(['pm', 'base'], () => {})
        expect(sortable.querySelector('[title="Drag to reorder Air Quality"]')).not.toBeNull()
        expect(sortable.querySelector('[title="Drag to reorder PM"]')).not.toBeNull()
    })

    test("a group's info button shows its description, and is inert without one", async () => {
        const root = await render(['pm', 'o3', 'fc', 'base'])
        const info = (groupId: string) =>
            root.querySelector(
                `[data-group-id="${groupId}"] > .blocks-layer-tree__group-header [title$="info"], [data-group-id="${groupId}"] > .blocks-layer-tree__group-header [title="No description available"]`,
            )!

        const aqs = info('aqs')
        expect(aqs.getAttribute('aria-disabled')).toBe('true')
        await click(aqs)
        expect(aqs.getAttribute('aria-expanded')).toBeNull()

        const aq = info('aq')
        expect(aq.getAttribute('aria-disabled')).toBe('false')
        await click(aq)
        expect(aq.getAttribute('aria-expanded')).toBe('true')
        expect(document.body.textContent).toContain('Surface monitors and the forecast.')
    })

    test('a group starts collapsed unless its header is configured expanded', async () => {
        const rows = ['pm', 'o3', 'fc', 'base'].map(layer)
        const unset: Record<string, GroupInfo> = {
            aq: { ...GROUPS.aq, expanded: undefined },
            aqs: { ...GROUPS.aqs, expanded: true },
        }
        mounted = await mount(
            <LayerManagerPanel layers={rows} nodes={buildLayerList(rows, STRUCTURE, unset)} />,
        )
        const root = mounted.container
        expect(chevron(root, 'aq').getAttribute('aria-expanded')).toBe('false')
        expect(rowIds(root)).toEqual(['base'])

        // AQS is configured open, so it shows open once its parent is.
        await click(chevron(root, 'aq'))
        expect(chevron(root, 'aqs').getAttribute('aria-expanded')).toBe('true')
        expect(rowIds(root)).toEqual(['pm', 'o3', 'fc', 'base'])
    })

    test('a group opened by hand stays open when the rows refresh', async () => {
        const rows = ['pm', 'o3', 'fc', 'base'].map(layer)
        const closed = { ...GROUPS, aq: { ...GROUPS.aq, expanded: false } }
        mounted = await mount(<LayerManagerPanel layers={rows} nodes={buildLayerList(rows, STRUCTURE, closed)} />)
        const root = mounted.container
        await click(chevron(root, 'aq'))
        await mounted.rerender(<LayerManagerPanel layers={rows} nodes={buildLayerList(rows, STRUCTURE, closed)} />)
        expect(chevron(root, 'aq').getAttribute('aria-expanded')).toBe('true')
    })

    test('nothing to show renders the empty message', async () => {
        mounted = await mount(<LayerManagerPanel layers={[]} nodes={[]} />)
        expect(mounted.container.querySelector('.blocks-layer-legend-list__empty')).not.toBeNull()
    })
})
