import { describe, test, expect } from 'vitest'
import {
    toTimePoints,
    toLinearPoints,
    toCategoryData,
    makeTimeTickFormat,
    formatTooltipTime,
    buildChartOption,
    buildVariableCardOption,
    seriesToCsv,
} from '../../src/essence/Tools/SeriesChart/lib/chartData.ts'

const THEME = {
    palette: ['#111111', '#222222'],
    gridColor: '#dddddd',
    textColor: '#555555',
    surface: '#eeeeee',
}

const DAY = 24 * 60 * 60 * 1000

function payloadWith(series, xType = 'time') {
    return { chartId: 'c1', title: 'T', xType, series }
}

describe('seriesChart chartData', () => {
    describe('toTimePoints', () => {
        test('parses ISO datetimes to epoch ms and keeps null gaps', () => {
            const pts = toTimePoints([
                { x: '2026-01-02T00:00:00Z', y: 2 },
                { x: '2026-01-01T00:00:00Z', y: null },
            ])
            expect(pts).toEqual([
                { x: Date.parse('2026-01-01T00:00:00Z'), y: null },
                { x: Date.parse('2026-01-02T00:00:00Z'), y: 2 },
            ])
        })

        test('drops unparseable x values instead of sinking the series', () => {
            const pts = toTimePoints([
                { x: 'garbage', y: 1 },
                { x: '2026-01-01T00:00:00Z', y: 3 },
            ])
            expect(pts).toHaveLength(1)
            expect(pts[0].y).toBe(3)
        })

        test('passes numeric x through as ms', () => {
            expect(toTimePoints([{ x: 1000, y: 1 }])).toEqual([{ x: 1000, y: 1 }])
        })

        test('reads timezone-less ISO datetimes as UTC, not viewer-local', () => {
            expect(toTimePoints([{ x: '2017-12-31T00:00:00', y: 1 }])).toEqual([
                { x: Date.parse('2017-12-31T00:00:00Z'), y: 1 },
            ])
        })
    })

    describe('toLinearPoints', () => {
        test('coerces numeric strings and drops NaN', () => {
            expect(
                toLinearPoints([
                    { x: '2', y: 1 },
                    { x: 'nope', y: 5 },
                    { x: 1, y: 0 },
                ]),
            ).toEqual([
                { x: 1, y: 0 },
                { x: 2, y: 1 },
            ])
        })
    })

    describe('toCategoryData', () => {
        test('unions labels in first-appearance order and aligns rows', () => {
            const { labels, rows } = toCategoryData([
                {
                    id: 'a',
                    label: 'A',
                    points: [
                        { x: 'jan', y: 1 },
                        { x: 'feb', y: 2 },
                    ],
                },
                {
                    id: 'b',
                    label: 'B',
                    points: [
                        { x: 'feb', y: 20 },
                        { x: 'mar', y: 30 },
                    ],
                },
            ])
            expect(labels).toEqual(['jan', 'feb', 'mar'])
            expect(rows).toEqual([
                [1, 2, null],
                [null, 20, 30],
            ])
        })
    })

    describe('makeTimeTickFormat', () => {
        const t0 = Date.parse('2026-03-04T14:30:00Z')
        test('uses hours+minutes within a two-day span', () => {
            expect(makeTimeTickFormat(t0, t0 + DAY)(t0)).toBe('14:30')
        })
        test('uses month+day within ~a year', () => {
            expect(makeTimeTickFormat(t0, t0 + 100 * DAY)(t0)).toBe('Mar 4')
        })
        test('uses month+year for multi-year spans', () => {
            expect(makeTimeTickFormat(t0, t0 + 800 * DAY)(t0)).toBe('Mar 2026')
        })
    })

    describe('formatTooltipTime', () => {
        test('formats a full UTC datetime', () => {
            expect(formatTooltipTime(Date.parse('2026-03-04T14:30:00Z'))).toBe(
                'Mar 4, 2026, 14:30',
            )
        })
    })

    describe('buildChartOption', () => {
        const series = (over = {}) => ({
            id: 's1',
            label: 'S1',
            points: [
                { x: '2026-01-01T00:00:00Z', y: 1 },
                { x: '2026-01-02T00:00:00Z', y: 2 },
            ],
            ...over,
        })

        test('time axis: value scale over epoch ms with a UTC tick formatter', () => {
            const opt = buildChartOption(payloadWith([series()]), THEME)
            expect(opt.xAxis.type).toBe('value')
            expect(typeof opt.xAxis.axisLabel.formatter).toBe('function')
            expect(opt.series[0].data[0]).toEqual([
                Date.parse('2026-01-01T00:00:00Z'),
                1,
            ])
        })

        test('legend and zoom are always available', () => {
            const opt = buildChartOption(payloadWith([series()]), THEME)
            expect(opt.legend.show).toBe(true)
            expect(opt.dataZoom.map((z) => z.type)).toEqual(['inside', 'slider'])
        })

        test('the zoom scrubber is a slim primary-filled range slider', () => {
            const opt = buildChartOption(payloadWith([series()]), THEME)
            const slider = opt.dataZoom.find((z) => z.type === 'slider')
            expect(slider.fillerColor).toBe('#111111')
            expect(slider.handleStyle.color).toBe('#111111')
            expect(slider.handleStyle.borderColor).toBe('#eeeeee')
            expect(slider.backgroundColor).toBe('#dddddd')
            expect(slider.handleIcon).toBe('circle')
            expect(slider.showDataShadow).toBe(false)
            expect(slider.moveHandleSize).toBe(0)
        })

        test('cycles the theme palette and honors explicit series color', () => {
            const opt = buildChartOption(
                payloadWith([
                    series(),
                    series({ id: 's2', label: 'S2' }),
                    series({ id: 's3', label: 'S3', color: '#abcdef' }),
                ]),
                THEME,
            )
            const colors = opt.series.map((s) => s.itemStyle.color)
            expect(colors).toEqual(['#111111', '#222222', '#abcdef'])
        })

        test('series style maps to type and area fill', () => {
            const opt = buildChartOption(
                payloadWith([
                    series({ style: 'bar' }),
                    series({ id: 's2', label: 'S2', style: 'area' }),
                ]),
                THEME,
            )
            expect(opt.series[0].type).toBe('bar')
            expect(opt.series[1].type).toBe('line')
            expect(opt.series[1].areaStyle).toBeDefined()
        })

        test('gaps are not connected', () => {
            const opt = buildChartOption(payloadWith([series()]), THEME)
            expect(opt.series[0].connectNulls).toBe(false)
        })

        test('time tooltip titles with UTC datetime, not raw epoch', () => {
            const opt = buildChartOption(payloadWith([series()]), THEME)
            const html = opt.tooltip.formatter([
                {
                    marker: '·',
                    seriesName: 'S1',
                    value: [Date.parse('2026-01-01T00:00:00Z'), 1],
                },
            ])
            expect(html).toContain('Jan 1, 2026')
            expect(html).toContain('S1: 1')
        })

        test('category axis uses aligned labels', () => {
            const opt = buildChartOption(
                payloadWith(
                    [series({ points: [{ x: 'jan', y: 1 }] })],
                    'category',
                ),
                THEME,
            )
            expect(opt.xAxis.type).toBe('category')
            expect(opt.xAxis.data).toEqual(['jan'])
            expect(opt.series[0].data).toEqual([1])
        })

        test('only the first variable starts visible; legend is single-select', () => {
            const opt = buildChartOption(
                payloadWith([
                    series({ unit: 'µg/m³' }),
                    series({ id: 's2', label: 'S2', unit: 'ppm' }),
                    series({ id: 's3', label: 'S3', unit: 'ppm' }),
                ]),
                THEME,
            )
            expect(opt.legend.selectedMode).toBe('single')
            expect(opt.legend.selected).toEqual({ S1: true, S2: false, S3: false })
            expect(opt.yAxis).toHaveLength(1)
            expect(opt.yAxis[0].name).toBe('µg/m³')
        })

        test('the y-axis renames to the picked variable unit', () => {
            const opt = buildChartOption(
                payloadWith([
                    series({ unit: 'µg/m³' }),
                    series({ id: 's2', label: 'S2', unit: 'Knots' }),
                ]),
                THEME,
                'S2',
            )
            expect(opt.legend.selected).toEqual({ S1: false, S2: true })
            expect(opt.yAxis[0].name).toBe('Knots')
        })

        test('no in-canvas toolbox: reset zoom lives in the card header', () => {
            const opt = buildChartOption(payloadWith([series()]), THEME)
            expect(opt.toolbox).toBeUndefined()
        })

        test('a single unit becomes the y-axis name', () => {
            const one = buildChartOption(
                payloadWith([series({ unit: 'ppm' })]),
                THEME,
            )
            expect(one.yAxis[0].name).toBe('ppm')
            expect(one.yAxis).toHaveLength(1)
            expect(one.legend.selected).toEqual({ S1: true })
        })

        test('yLabel wins as the y-axis name', () => {
            const withLabel = buildChartOption(
                { ...payloadWith([series()]), yLabel: 'NO₂' },
                THEME,
            )
            const without = buildChartOption(payloadWith([series()]), THEME)
            expect(withLabel.yAxis[0].name).toBe('NO₂')
            expect(without.yAxis[0].name).toBeUndefined()
        })
    })

    describe('buildVariableCardOption', () => {
        const series = (over = {}) => ({
            id: over.id ?? 's1',
            label: over.label ?? 'S1',
            points: [
                { x: '2026-01-01T00:00:00Z', y: 1 },
                { x: '2026-01-02T00:00:00Z', y: 2 },
            ],
            ...over,
        })
        const card = (s, over = {}) =>
            buildVariableCardOption(
                s,
                { ...payloadWith([s]), ...over },
                THEME,
                over.index ?? 0,
            )

        test('single clean series: no legend, no symbols, no gridlines', () => {
            const opt = card(series())
            expect(opt.legend).toBeUndefined()
            expect(opt.series).toHaveLength(1)
            expect(opt.series[0].showSymbol).toBe(false)
            expect(opt.yAxis.splitLine.show).toBe(false)
        })

        test('identity lives in the footer, not the plot: unnamed sparse y-axis', () => {
            const opt = card(series({ unit: 'ppm' }))
            expect(opt.yAxis.name).toBeUndefined()
            expect(opt.yAxis.splitNumber).toBe(2)
        })

        test('the palette slot follows the variable index, explicit color wins', () => {
            const s = series()
            const first = buildVariableCardOption(s, payloadWith([s]), THEME, 0)
            const second = buildVariableCardOption(s, payloadWith([s]), THEME, 1)
            expect(first.series[0].itemStyle.color).toBe(THEME.palette[0])
            expect(second.series[0].itemStyle.color).toBe(THEME.palette[1])
            const explicit = buildVariableCardOption(
                series({ color: '#abcdef' }),
                payloadWith([s]),
                THEME,
                1,
            )
            expect(explicit.series[0].itemStyle.color).toBe('#abcdef')
        })

        test('zoom strip previews the series in its own color', () => {
            const opt = card(series())
            const slider = opt.dataZoom.find((z) => z.type === 'slider')
            expect(slider.showDataShadow).toBe(true)
            expect(slider.dataBackground.lineStyle.color).toBe(THEME.palette[0])
            expect(opt.dataZoom.map((z) => z.type)).toEqual(['inside', 'slider'])
        })

        test('time cards format axis, slider labels, and tooltip as UTC', () => {
            const opt = card(series())
            expect(opt.xAxis.type).toBe('value')
            expect(typeof opt.xAxis.axisLabel.formatter).toBe('function')
            const slider = opt.dataZoom.find((z) => z.type === 'slider')
            expect(typeof slider.labelFormatter).toBe('function')
            expect(typeof opt.tooltip.formatter).toBe('function')
            expect(opt.series[0].data[0]).toEqual([
                Date.parse('2026-01-01T00:00:00Z'),
                1,
            ])
        })

        test('category cards use the variable’s own labels', () => {
            const s = series({
                points: [
                    { x: 'x1', y: 1 },
                    { x: 'x2', y: null },
                ],
            })
            const opt = buildVariableCardOption(
                s,
                payloadWith([s], 'category'),
                THEME,
                0,
            )
            expect(opt.xAxis.type).toBe('category')
            expect(opt.xAxis.data).toEqual(['x1', 'x2'])
            expect(opt.series[0].data).toEqual([1, null])
        })
    })

    describe('seriesToCsv', () => {
        test('two columns headed x and the series label; gaps are empty cells', () => {
            const csv = seriesToCsv({
                id: 'o3',
                label: 'O3',
                points: [
                    { x: '2026-01-01T00:00:00Z', y: 0.04 },
                    { x: '2026-01-02T00:00:00Z', y: null },
                ],
            })
            expect(csv.split('\n')).toEqual([
                'x,O3',
                '2026-01-01T00:00:00Z,0.04',
                '2026-01-02T00:00:00Z,',
            ])
        })

        test('fields with commas or quotes are quoted and escaped', () => {
            const csv = seriesToCsv({
                id: 's',
                label: 'PM2.5, "fine"',
                points: [{ x: 'a,b', y: 1 }],
            })
            expect(csv.split('\n')).toEqual([
                'x,"PM2.5, ""fine"""',
                '"a,b",1',
            ])
        })
    })

})
