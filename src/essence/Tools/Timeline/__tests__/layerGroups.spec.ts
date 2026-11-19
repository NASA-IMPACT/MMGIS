import { describe, test, expect } from 'vitest'
import {
    buildTimelineRows,
    type LayerGroupNode,
    type TimelineRow,
} from '../lib/utils/layerGroups'
import type { LayerTimeData } from '../lib/types'

const d = (iso: string) => new Date(`${iso}T00:00:00Z`)

const layer = (
    name: string,
    ranges: [string, string][] = [['2020-01-01', '2020-02-01']]
): LayerTimeData => ({
    name,
    displayName: name.toUpperCase(),
    color: `#${name}`,
    timeRanges: ranges.map(([start, end]) => ({ start: d(start), end: d(end) })),
})

const group = (
    id: string,
    children: LayerGroupNode[]
): LayerGroupNode => ({
    kind: 'group',
    id,
    displayName: `Group ${id}`,
    color: `#group-${id}`,
    children,
})
const leaf = (id: string): LayerGroupNode => ({ kind: 'layer', id })

/** Rows as `name@depth`, groups marked with their collapse state. */
const outline = (rows: TimelineRow[]) =>
    rows.map((row) =>
        row.kind === 'layer'
            ? `${row.layer.name}@${row.depth}`
            : `[${row.id}${row.collapsed ? '+' : '-'}]@${row.depth}`
    )

describe('buildTimelineRows', () => {
    const none = new Set<string>()

    test('places layers under their group', () => {
        const tree = [leaf('a'), group('g', [leaf('b'), leaf('c')])]
        const rows = buildTimelineRows(
            tree,
            [layer('a'), layer('b'), layer('c')],
            none
        )

        expect(outline(rows)).toEqual(['a@0', '[g-]@0', 'b@1', 'c@1'])
    })

    test('lists each level in draw order, a group where its top-most layer is', () => {
        // Draw order, top first: c, x, b. The group holds c, so it leads;
        // inside it c comes before b, whatever order the config gives.
        const tree = [leaf('x'), group('g', [leaf('b'), leaf('c')])]
        const rows = buildTimelineRows(
            tree,
            [layer('c'), layer('x'), layer('b')],
            none
        )

        expect(outline(rows)).toEqual(['[g-]@0', 'c@1', 'b@1', 'x@0'])
    })

    test('a collapsed group keeps its row and hides what it holds', () => {
        const tree = [group('g', [leaf('a'), leaf('b')]), leaf('c')]
        const rows = buildTimelineRows(
            tree,
            [layer('a'), layer('b'), layer('c')],
            new Set(['g'])
        )

        expect(outline(rows)).toEqual(['[g+]@0', 'c@0'])
    })

    test("a group's row carries every range of the layers beneath it, in its own colour", () => {
        const tree = [group('g', [leaf('a'), group('h', [leaf('b')])])]
        const rows = buildTimelineRows(
            tree,
            [
                layer('a', [['2020-01-01', '2020-02-01']]),
                layer('b', [
                    ['2020-01-15', '2020-03-01'],
                    ['2020-06-01', '2020-07-01'],
                ]),
            ],
            new Set(['g'])
        )

        const row = rows[0]
        expect(row.kind).toBe('group')
        if (row.kind !== 'group') return
        expect(row.summary.timeRanges).toEqual([
            { start: d('2020-01-01'), end: d('2020-02-01') },
            { start: d('2020-01-15'), end: d('2020-03-01') },
            { start: d('2020-06-01'), end: d('2020-07-01') },
        ])
        expect(row.summary.color).toBe('#group-g')
        expect(row.summary.navigation).toBeNull()
        expect(row.summary.displayName).toBe('Group g')
    })

    test('nested groups indent and collapse independently', () => {
        const tree = [group('g', [leaf('a'), group('h', [leaf('b')])])]
        const layers = [layer('a'), layer('b')]

        expect(outline(buildTimelineRows(tree, layers, none))).toEqual([
            '[g-]@0',
            'a@1',
            '[h-]@1',
            'b@2',
        ])
        expect(outline(buildTimelineRows(tree, layers, new Set(['h'])))).toEqual([
            '[g-]@0',
            'a@1',
            '[h+]@1',
        ])
    })

    test('drops a group none of whose layers are shown', () => {
        const tree = [group('g', [leaf('a'), group('h', [leaf('b')])])]
        const rows = buildTimelineRows(tree, [layer('a')], none)

        expect(outline(rows)).toEqual(['[g-]@0', 'a@1'])
    })

    test('places a layer the grouping names twice only once', () => {
        const tree = [leaf('a'), group('g', [leaf('a'), leaf('b')])]
        const rows = buildTimelineRows(tree, [layer('a'), layer('b')], none)

        expect(outline(rows)).toEqual(['a@0', '[g-]@0', 'b@1'])
    })

    test('ranks a layer the grouping does not mention among the top level', () => {
        const rows = buildTimelineRows(
            [group('g', [leaf('a')]), leaf('b')],
            [layer('a'), layer('z'), layer('b')],
            none
        )

        expect(outline(rows)).toEqual(['[g-]@0', 'a@1', 'z@0', 'b@0'])
    })

    test('without a grouping, lists the layers flat in their own order', () => {
        const rows = buildTimelineRows(null, [layer('b'), layer('a')], none)

        expect(outline(rows)).toEqual(['b@0', 'a@0'])
    })
})
