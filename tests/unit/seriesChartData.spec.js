import { describe, test, expect } from 'vitest'
import {
    toTimePoints,
    makeTimeTickFormat,
    formatTooltipTime,
    buildChartOption,
    buildChart,
    seriesToCsv,
    csvFileName,
} from '../../src/essence/Tools/SeriesChart/lib/chartData.ts'

const THEME = {
    palette: ['#111111', '#222222'],
    gridColor: '#dddddd',
    textColor: '#555555',
}

const DAY = 24 * 60 * 60 * 1000

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

        test('reads space-separated timezone-less datetimes as UTC too', () => {
            expect(toTimePoints([{ x: '2017-12-31 06:30:00', y: 1 }])).toEqual([
                { x: Date.parse('2017-12-31T06:30:00Z'), y: 1 },
            ])
        })
    })

    describe('makeTimeTickFormat', () => {
        const t0 = Date.parse('2026-03-04T14:30:00Z')
        test('uses hours+minutes inside one UTC day', () => {
            expect(makeTimeTickFormat(t0, t0 + 6 * 60 * 60 * 1000)(t0)).toBe('14:30')
        })
        test('adds the day once the span crosses midnight, so two days do not read as one', () => {
            const fmt = makeTimeTickFormat(t0, t0 + DAY)
            expect(fmt(t0)).toBe('Mar 4, 14:30')
            expect(fmt(Date.parse('2026-03-05T00:40:00Z'))).toBe('Mar 5, 00:40')
        })
        test('uses month+day within ~a year', () => {
            expect(makeTimeTickFormat(t0, t0 + 100 * DAY)(t0)).toBe('Mar 4')
        })
        test('uses month+year for multi-year spans', () => {
            expect(makeTimeTickFormat(t0, t0 + 800 * DAY)(t0)).toBe('Mar 2026')
        })
    })

    describe('formatTooltipTime', () => {
        test('prints the UTC date without a cadence, as for a daily one', () => {
            expect(formatTooltipTime(Date.parse('2026-03-04T14:30:00Z'))).toBe(
                'Mar 4, 2026',
            )
            expect(formatTooltipTime(Date.parse('2026-03-04T23:30:00-05:00'))).toBe(
                'Mar 5, 2026',
            )
        })

        test('prints at the cadence: a clock for hourly, no day for monthly, the year alone for yearly', () => {
            const ms = Date.parse('2026-03-04T14:30:00Z')
            expect(formatTooltipTime(ms, 'hour')).toBe('Mar 4, 2026, 14:30')
            expect(formatTooltipTime(ms, 'day')).toBe('Mar 4, 2026')
            expect(formatTooltipTime(ms, 'month')).toBe('Mar 2026')
            expect(formatTooltipTime(ms, 'year')).toBe('2026')
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
        const card = (s, index = 0) => buildChartOption(s, THEME, index)

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
            expect(opt.graphic).toBeUndefined()
            expect(opt.yAxis.splitNumber).toBe(2)
        })

        test('only the time axis drives the tooltip, so a series is listed once', () => {
            expect(card(series()).yAxis.axisPointer.triggerTooltip).toBe(false)
        })

        test('the plot keeps equal margins on both sides, so it sits centred', () => {
            const { grid } = card(series({ unit: 'ppm' }))
            expect(grid.left).toBe(grid.right)
        })

        test('the tooltip is attached to the page body, out of reach of the panel clipping', () => {
            expect(card(series()).tooltip.appendTo).toBe('body')
        })

        test('tooltip values carry the unit, escaped; a gap reads as a dash without it', () => {
            const fmt = card(series({ unit: '<b>ppm' })).tooltip.formatter
            const at = Date.parse('2026-01-01T00:00:00Z')
            expect(fmt([{ marker: '·', seriesName: 'S1', value: [at, 4] }])).toContain(
                'S1: 4 &lt;b&gt;ppm',
            )
            expect(fmt([{ marker: '·', seriesName: 'S1', value: [at, null] }])).toContain(
                'S1: —',
            )
        })

        test('the tooltip title is the date only, even for a mid-day point', () => {
            const html = card(series()).tooltip.formatter([
                { marker: '·', seriesName: 'S1', value: [Date.parse('2026-01-01T14:30:00Z'), 1] },
            ])
            expect(html).toContain('Jan 1, 2026<br/>')
            expect(html).not.toContain('14:30')
        })

        test('an hourly cadence puts the clock in the tooltip title', () => {
            const html = buildChartOption(series(), THEME, 0, 'hour').tooltip.formatter([
                { marker: '·', seriesName: 'S1', value: [Date.parse('2026-01-01T14:30:00Z'), 1] },
            ])
            expect(html).toContain('Jan 1, 2026, 14:30<br/>')
        })

        test('the palette slot follows the variable index, explicit color wins', () => {
            const s = series()
            const first = buildChartOption(s, THEME, 0)
            const second = buildChartOption(s, THEME, 1)
            expect(first.series[0].itemStyle.color).toBe(THEME.palette[0])
            expect(second.series[0].itemStyle.color).toBe(THEME.palette[1])
            const explicit = buildChartOption(series({ color: '#abcdef' }), THEME, 1)
            expect(explicit.series[0].itemStyle.color).toBe('#abcdef')
        })

        test('zoom strip previews the series in its own color', () => {
            const opt = card(series())
            const slider = opt.dataZoom.find((z) => z.type === 'slider')
            expect(slider.showDataShadow).toBe(true)
            expect(slider.dataBackground.lineStyle.color).toBe(THEME.palette[0])
            expect(opt.dataZoom.map((z) => z.type)).toEqual(['inside', 'slider'])
        })

        test('time cards format axis and tooltip as UTC', () => {
            const opt = card(series())
            expect(opt.xAxis.type).toBe('time')
            expect(opt.useUTC).toBe(true)
            expect(typeof opt.xAxis.axisLabel.formatter).toBe('function')
            expect(typeof opt.tooltip.formatter).toBe('function')
            expect(opt.series[0].data[0]).toEqual([
                Date.parse('2026-01-01T00:00:00Z'),
                1,
            ])
        })

        test('six-figure point counts build without arg-spread overflow', () => {
            const points = Array.from({ length: 200000 }, (_, i) => ({
                x: i * 60000,
                y: i % 100,
            }))
            const opt = card(series({ points }))
            expect(opt.series[0].data).toHaveLength(200000)
            expect(typeof opt.xAxis.axisLabel.formatter).toBe('function')
        })

        test('series style maps to type and area fill', () => {
            expect(card(series({ style: 'bar' })).series[0].type).toBe('bar')
            const area = card(series({ style: 'area' })).series[0]
            expect(area.type).toBe('line')
            expect(area.areaStyle).toBeDefined()
        })

        test('gaps are not connected', () => {
            expect(card(series()).series[0].connectNulls).toBe(false)
        })

        test('the tooltip titles with the UTC datetime, not raw epoch', () => {
            const html = card(series()).tooltip.formatter([
                {
                    marker: '·',
                    seriesName: 'S1',
                    value: [Date.parse('2026-01-01T00:00:00Z'), 1],
                },
            ])
            expect(html).toContain('Jan 1, 2026')
            expect(html).toContain('S1: 1')
        })

        test('a series name from the wire is escaped before it reaches the tooltip HTML', () => {
            const html = card(series()).tooltip.formatter([
                {
                    marker: '·',
                    seriesName: '<img src=x onerror="alert(1)">',
                    value: [Date.parse('2026-01-01T00:00:00Z'), 1],
                },
            ])
            expect(html).not.toContain('<img')
            expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;: 1')
        })

        test('the strip shows no hover labels; the window dates are always shown instead', () => {
            const slider = card(series()).dataZoom.find((z) => z.type === 'slider')
            expect(slider.showDetail).toBe(false)
        })

        test('the window dates name the zoomed span, date only across days', () => {
            const long = series({
                points: [
                    { x: '2026-01-01T00:00:00Z', y: 1 },
                    { x: '2026-01-11T00:00:00Z', y: 2 },
                ],
            })
            const { windowText } = buildChart(long, THEME, 0)
            expect(windowText(0, 100)).toEqual(['Jan 1, 2026', 'Jan 11, 2026'])
            expect(windowText(10, 50)).toEqual(['Jan 2, 2026', 'Jan 6, 2026'])
        })

        test('the window dates stay date-only inside a short span too', () => {
            const [start] = buildChart(series(), THEME, 0).windowText(50, 100)
            expect(start).toBe('Jan 1, 2026')
        })

        test('the window dates print at the cadence', () => {
            const long = series({
                points: [
                    { x: '2026-01-01T00:00:00Z', y: 1 },
                    { x: '2026-12-01T00:00:00Z', y: 2 },
                ],
            })
            expect(buildChart(long, THEME, 0, 'month').windowText(0, 100)).toEqual([
                'Jan 2026',
                'Dec 2026',
            ])
            expect(buildChart(long, THEME, 0, 'hour').windowText(0, 100)).toEqual([
                'Jan 1, 2026, 00:00',
                'Dec 1, 2026, 00:00',
            ])
        })

        test('a series with no readable times has no window dates', () => {
            const empty = series({ points: [{ x: 'not a time', y: 1 }] })
            expect(buildChart(empty, THEME, 0).windowText(0, 100)).toBeNull()
        })

        test('no in-canvas toolbox or legend: the dropdown picks, the strip resets', () => {
            const opt = card(series())
            expect(opt.toolbox).toBeUndefined()
            expect(opt.legend).toBeUndefined()
        })
    })

    describe('seriesToCsv', () => {
        test('two columns headed timestamp and the series label; gaps are empty cells', () => {
            const csv = seriesToCsv({
                id: 'o3',
                label: 'O3',
                points: [
                    { x: '2026-01-01T00:00:00Z', y: 0.04 },
                    { x: '2026-01-02T00:00:00Z', y: null },
                ],
            })
            expect(csv.split('\n')).toEqual([
                'timestamp,O3',
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
                'timestamp,"PM2.5, ""fine"""',
                '"a,b",1',
            ])
        })

        test('fields with lone carriage returns are quoted', () => {
            const csv = seriesToCsv({
                id: 's',
                label: 'a\rb',
                points: [{ x: 1, y: 1 }],
            })
            expect(csv.split('\n')[0]).toBe('timestamp,"a\rb"')
        })
    })

    describe('csvFileName', () => {
        test('names the file after the card: title, section heading, variable', () => {
            expect(
                csvFileName([
                    'Washington, Georgia · Site 1',
                    'AQS Surface PM₂.₅ Concentration',
                    '24-HR BLK AVG',
                ]),
            ).toBe(
                'Washington_Georgia_Site_1_AQS_Surface_PM2.5_Concentration_24-HR_BLK_AVG.csv',
            )
        })

        test('skips a missing heading and a variable that repeats it', () => {
            expect(csvFileName(['Site 1', undefined, 'O3'])).toBe('Site_1_O3.csv')
            // An ungrouped series is labelled with the layer name, which is
            // also the heading.
            expect(
                csvFileName([
                    'Site 1',
                    'AQS Surface O₃ Concentration',
                    'AQS Surface O₃ Concentration',
                ]),
            ).toBe('Site_1_AQS_Surface_O3_Concentration.csv')
        })

        test('accents and bracketing punctuation leave clean words', () => {
            expect(csvFileName(['Montréal (Site 1)', undefined, 'PM10'])).toBe(
                'Montreal_Site_1_PM10.csv',
            )
        })

        test('falls back when every part is empty', () => {
            expect(csvFileName(['', undefined, ''])).toBe('series.csv')
        })
    })
})
