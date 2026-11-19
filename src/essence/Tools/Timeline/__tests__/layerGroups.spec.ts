import { describe, test, expect } from 'vitest'
import {
    buildTimelineRows,
    mergeRanges,
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
): LayerGroupNode => ({ kind: 'group', id, displayName: `Group ${id}`, children })
const leaf = (id: string): LayerGroupNode => ({ kind: 'layer', id })

/** Rows as `name@depth`, groups marked with their collapse state. */
const outline = (rows: TimelineRow[]) =>
    rows.map((row) =>
        row.kind === 'layer'
            ? `${row.layer.name}@${row.depth}`
            : `[${row.id}${row.collapsed ? '+' : '-'}]@${row.depth}`
    )

describe('mergeRanges', () => {
    test('joins overlapping and touching ranges, in time order', () => {
        const merged = mergeRanges([
            { start: d('2020-03-01'), end: d('2020-04-01') },
            { start: d('2020-01-01'), end: d('2020-02-01') },
            { start: d('2020-02-01'), end: d('2020-02-15'), label: 'Feb' },
            { start: d('2020-03-15'), end: d('2020-03-20') },
        ])

        expect(merged).toEqual([
            { start: d('2020-01-01'), end: d('2020-02-15') },
            { start: d('2020-03-01'), end: d('2020-04-01') },
        ])
    })

    test('leaves the input ranges untouched', () => {
        const first = { start: d('2020-01-01'), end: d('2020-02-01') }
        mergeRanges([first, { start: d('2020-01-15'), end: d('2020-03-01') }])

        expect(first.end).toEqual(d('2020-02-01'))
    })
})

describe('buildTimelineRows', () => {
    const none = new Set<string>()

    test('places layers under their group, in the grouping order', () => {
        const tree = [leaf('a'), group('g', [leaf('c'), leaf('b')])]
        const rows = buildTimelineRows(
            tree,
            [layer('b'), layer('a'), layer('c')],
            none
        )

        expect(outline(rows)).toEqual(['a@0', '[g-]@0', 'c@1', 'b@1'])
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

    test("a collapsed group's row carries the combined coverage of its layers", () => {
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
            { start: d('2020-01-01'), end: d('2020-03-01') },
            { start: d('2020-06-01'), end: d('2020-07-01') },
        ])
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

    test('lists layers the grouping does not mention after it, ungrouped', () => {
        const rows = buildTimelineRows(
            [group('g', [leaf('a')])],
            [layer('z'), layer('a')],
            none
        )

        expect(outline(rows)).toEqual(['[g-]@0', 'a@1', 'z@0'])
    })

    test('without a grouping, lists the layers flat in their own order', () => {
        const rows = buildTimelineRows(null, [layer('b'), layer('a')], none)

        expect(outline(rows)).toEqual(['b@0', 'a@0'])
    })
})
