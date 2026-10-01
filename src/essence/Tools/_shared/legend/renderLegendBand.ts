import type { ExportLegendModel, ExportLegendRow } from './getExportLegendModel'
import { DEFAULT_BAND_THEME, type BandTheme } from './bandTheme'

// All metrics are logical px, multiplied by `scale` at layout time so the
// band stays proportionate to hi-DPI captures (capture size follows
// devicePixelRatio). Measure and draw both read the one layout `layoutBand`
// builds, so every constant reaches both passes through the same numbers.

// Clear space between the band's edge and its content.
const PAD = 32
// Type sizes, largest to smallest: the mission title, row names, then dates
// and header values, then the header labels and the bound and category
// labels.
const TITLE_TEXT = 20
const ROW_TITLE_TEXT = 14
const META_TEXT = 12
const LABEL_TEXT = 11
// Space between stacked lines of one text block.
const LINE_GAP = 4
// Header spacing: a header fact's label sits tight over its value, and each
// fact (the first one included, under the title) is set off from what comes
// before it.
const FACT_LABEL_GAP = 2
const FACT_GAP = 12
// Clear space either side of the hairline that parts the header from the
// rows when the header stacks on top of them.
const SECTION_GAP = 28
// Vertical space between two lines of rows.
const ROW_GAP = 20
// Space between a row's text and its ramp or swatches.
const BODY_GAP = 8
const BAR_HEIGHT = 8
const BAR_WIDTH = 280
const SWATCH = 12
// Swatch-to-label and item-to-item spacing on a swatch line.
const SWATCH_GAP = 6
const ITEM_GAP = 16
// Clear space kept between a gradient bar's two bound labels.
const BOUND_GAP = 10
// Rows flow into columns once their area is wide enough to hold more than one
// column of at least MIN_COL_WIDTH.
const COL_GAP = 32
const MIN_COL_WIDTH = 240
const MAX_COLS = 3
// With room for at least this much content width, the header takes a column
// of its own to the left of the rows; below it, the header stacks on top.
const SIDE_HEADER_MIN_WIDTH = 760
// The header column is as wide as its longest line, so the rows start right
// after it, but never wider than this share of the band; longer text wraps
// within it.
const HEADER_COL_MAX_SHARE = 0.25
// A header line wraps onto at most this many lines, the last one ellipsized.
const HEADER_MAX_LINES = 4
// Clear space either side of the header column's hairline: the floor when
// the header fills its share of the band, plus a share of whatever width a
// shorter header leaves unused, up to a cap. The share is under half, so the
// gap shrinks more slowly than the column grows and a longer header only ever
// moves the rows right.
const SIDE_GAP_MIN = 48
const SIDE_GAP_MAX = 96
const SIDE_GAP_SPARE_SHARE = 0.2

const NEUTRAL_RAMP = ['#bdbdbd', '#757575']
const FALLBACK_SWATCH = '#bdbdbd'
// Relative luminance above which a swatch or ramp end is too pale to hold an
// edge against the white band, and gets a hairline.
const PALE_LUMINANCE = 0.85

const FONT = (px: number, scale: number, weight: string, theme: BandTheme) =>
    `${weight} ${Math.round(px * scale)}px ${theme.family}`

// Hairlines are one device pixel per unit of scale so they read the same at
// every DPR.
const ruleOf = (scale: number): number => Math.max(1, Math.round(scale))

/**
 * A bound as its label: rounded to three decimal places, with trailing zeros
 * dropped, and exponential outside the magnitudes that rounding can say
 * anything about. A bound the layer never declared prints blank rather than
 * inventing a 0.
 *
 * These are the panel's own gradient-bar rules (GradientGraphic's
 * formatLegendValue), restated rather than shared: that formatter lives in the
 * panel's portable lib, which may not import this side. They must stay
 * identical, or the same layer reads one way in the app and another on the
 * export.
 */
const boundValue = (value: number | null): string => {
    if (value == null || !Number.isFinite(value)) return ''
    const magnitude = Math.abs(value)
    return value !== 0 && (magnitude >= 9999 || magnitude <= 0.0009)
        ? value.toExponential(2)
        : String(parseFloat(value.toFixed(3)))
}

/** A bound and its unit as one label; blank when the bound is. */
export const boundLabel = (
    value: number | null,
    unit: string | null,
): string => {
    const text = boundValue(value)
    return text && unit ? `${text} ${unit}` : text
}

/**
 * Truncates `text` to fit `maxWidth`, appending an ellipsis, so a long
 * header/title/category label can't overflow the band. A no-op when the text
 * already fits.
 */
const clipText = (ctx: Ctx2D, text: string, maxWidth: number): string => {
    if (maxWidth <= 0) return ''
    if (ctx.measureText(text).width <= maxWidth) return text
    const ellipsis = '…'
    let clipped = text
    while (
        clipped.length > 0 &&
        ctx.measureText(clipped + ellipsis).width > maxWidth
    ) {
        clipped = clipped.slice(0, -1)
    }
    return clipped.length > 0 ? clipped + ellipsis : ellipsis
}

type Ctx2D = Pick<
    CanvasRenderingContext2D,
    | 'fillRect'
    | 'fillText'
    | 'measureText'
    | 'createLinearGradient'
    | 'save'
    | 'restore'
> & { fillStyle: unknown; font: string; textBaseline: CanvasTextBaseline }

/**
 * Whether `color` is pale enough to vanish against the white band. The canvas
 * normalizes any CSS color it accepts to `#rrggbb` or `rgba(...)` on
 * assignment, which is what gets parsed; a color it can't read counts as not
 * pale.
 */
const isPale = (ctx: Ctx2D, color: string): boolean => {
    const previous = ctx.fillStyle
    ctx.fillStyle = color
    const normalized = String(ctx.fillStyle)
    ctx.fillStyle = previous
    let rgb: number[] | null = null
    let alpha = 1
    const hex = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
    if (hex) {
        const h =
            hex[1].length === 3
                ? hex[1].replace(/./g, (c) => c + c)
                : hex[1]
        rgb = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
    } else {
        const fn = normalized.match(/^rgba?\(([^)]+)\)$/i)
        if (fn) {
            const parts = fn[1].split(/[\s,/]+/).filter(Boolean).map(Number)
            rgb = parts.slice(0, 3)
            if (parts.length > 3) alpha = parts[3]
        }
    }
    if (!rgb || rgb.some((c) => !Number.isFinite(c))) return false
    if (alpha < 0.5) return true
    const [r, g, b] = rgb.map((c) => {
        const s = c / 255
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > PALE_LUMINANCE
}

// The header's lines in draw order: the mission name, then each fact as a
// small label over its value. The renderer prints them without knowing what
// any of them says.
type HeaderLine = {
    text: string
    size: number
    weight: string
    color: string
    /** Clear space above this line; none above the first. */
    gapBefore: number
}

const headerLinesOf = (
    model: ExportLegendModel,
    theme: BandTheme,
): HeaderLine[] => {
    const lines: HeaderLine[] = []
    if (model.missionName) {
        lines.push({
            text: model.missionName,
            size: TITLE_TEXT,
            weight: theme.weights.semibold,
            color: theme.ink,
            gapBefore: 0,
        })
    }
    for (const fact of model.headerFacts) {
        lines.push({
            text: fact.label,
            size: LABEL_TEXT,
            weight: theme.weights.regular,
            color: theme.muted,
            gapBefore: lines.length > 0 ? FACT_GAP : 0,
        })
        lines.push({
            text: fact.value,
            size: META_TEXT,
            weight: theme.weights.regular,
            color: theme.ink,
            gapBefore: FACT_LABEL_GAP,
        })
    }
    return lines
}

/** A header line wrapped to the width it was laid out at. */
type HeaderBlock = HeaderLine & { wrapped: string[] }

/**
 * Breaks `text` at spaces into lines no wider than `maxWidth`, at most
 * `maxLines` of them. Whatever doesn't fit goes on the last line, ellipsized,
 * as does a single word too long for a line of its own.
 */
const wrapText = (
    ctx: Ctx2D,
    text: string,
    maxWidth: number,
    maxLines: number,
): string[] => {
    const words = text.split(/\s+/).filter(Boolean)
    const lines: string[] = []
    let i = 0
    while (i < words.length && lines.length < maxLines - 1) {
        let line = words[i++]
        while (
            i < words.length &&
            ctx.measureText(`${line} ${words[i]}`).width <= maxWidth
        ) {
            line += ` ${words[i++]}`
        }
        lines.push(clipText(ctx, line, maxWidth))
    }
    if (i < words.length) {
        lines.push(clipText(ctx, words.slice(i).join(' '), maxWidth))
    }
    return lines.length > 0 ? lines : ['']
}

const fontOf = (line: HeaderLine, scale: number, theme: BandTheme) =>
    FONT(line.size, scale, line.weight, theme)

/** The width the widest header line takes unwrapped. */
const headerNaturalWidth = (
    ctx: Ctx2D,
    lines: HeaderLine[],
    scale: number,
    theme: BandTheme,
): number =>
    Math.max(
        0,
        ...lines.map((line) => {
            ctx.font = fontOf(line, scale, theme)
            return ctx.measureText(line.text).width
        }),
    )

const wrapHeader = (
    ctx: Ctx2D,
    lines: HeaderLine[],
    width: number,
    scale: number,
    theme: BandTheme,
): HeaderBlock[] =>
    lines.map((line) => {
        ctx.font = fontOf(line, scale, theme)
        return {
            ...line,
            wrapped: wrapText(ctx, line.text, width, HEADER_MAX_LINES),
        }
    })

const headerHeight = (blocks: HeaderBlock[], scale: number): number =>
    blocks.reduce(
        (h, block) =>
            h +
            block.gapBefore * scale +
            block.wrapped.length * block.size * scale +
            (block.wrapped.length - 1) * LINE_GAP * scale,
        0,
    )

/** One swatch and its label, placed relative to its cell's top-left. */
type CategoryItem = {
    label: string
    color: string
    pale: boolean
    dx: number
    line: number
}

/** One row placed in the grid: its column offset and width, its height, and
 *  for a categorical row the swatches already wrapped to that width. */
type Cell = {
    row: ExportLegendRow
    x: number
    width: number
    height: number
    items: CategoryItem[]
}

/** One horizontal line of cells; `y` is relative to the rows' top. */
type RowLine = { y: number; height: number; cells: Cell[] }

type Layout = {
    rule: number
    pad: number
    header: HeaderBlock[]
    /** The hairline between header and rows, relative to the content box. */
    divider: { x: number; y: number; w: number; h: number } | null
    /** Where the rows' area starts, relative to the content box. */
    rowsX: number
    rowsY: number
    lines: RowLine[]
    bandHeight: number
}

// The line a row's date occupies under its title, for the rows that carry
// one; the draw pass advances by exactly this much before the row's body.
const dateLineHeight = (row: ExportLegendRow, scale: number): number =>
    row.dateLine ? (LINE_GAP + META_TEXT) * scale : 0

const rowHeadHeight = (row: ExportLegendRow, scale: number): number =>
    ROW_TITLE_TEXT * scale + dateLineHeight(row, scale)

const wrapCategorical = (
    ctx: Ctx2D,
    stops: { color: string; label: string }[],
    cellWidth: number,
    scale: number,
    theme: BandTheme,
): CategoryItem[] => {
    ctx.font = FONT(LABEL_TEXT, scale, theme.weights.light, theme)
    // The widest a single label can render, so that even alone on a fresh
    // line it can't overflow the cell.
    const labelMaxWidth = cellWidth - (SWATCH + SWATCH_GAP) * scale
    const items: CategoryItem[] = []
    let x = 0
    let line = 0
    for (const stop of stops) {
        const label = clipText(ctx, stop.label, labelMaxWidth)
        const itemW =
            (SWATCH + SWATCH_GAP) * scale + ctx.measureText(label).width
        if (x > 0 && x + itemW > cellWidth) {
            line += 1
            x = 0
        }
        const color = stop.color || FALLBACK_SWATCH
        items.push({ label, color, pale: isPale(ctx, color), dx: x, line })
        x += itemW + ITEM_GAP * scale
    }
    return items
}

const cellOf = (
    ctx: Ctx2D,
    row: ExportLegendRow,
    x: number,
    width: number,
    scale: number,
    theme: BandTheme,
): Cell => {
    const head = rowHeadHeight(row, scale)
    if (row.kind === 'gradient') {
        const body = (BODY_GAP + BAR_HEIGHT + LINE_GAP + LABEL_TEXT) * scale
        return { row, x, width, height: head + body, items: [] }
    }
    if (row.kind === 'plain') {
        // A name and its date line: there is no graphic under them to leave
        // room for.
        return { row, x, width, height: head, items: [] }
    }
    const items = wrapCategorical(ctx, row.stops, width, scale, theme)
    const lines = items.length > 0 ? items[items.length - 1].line + 1 : 1
    const body =
        BODY_GAP * scale +
        lines * SWATCH * scale +
        (lines - 1) * LINE_GAP * scale
    return { row, x, width, height: head + body, items }
}

const columnCount = (areaWidth: number, rows: number, scale: number): number =>
    Math.max(
        1,
        Math.min(
            MAX_COLS,
            rows,
            Math.floor(
                (areaWidth + COL_GAP * scale) /
                    ((MIN_COL_WIDTH + COL_GAP) * scale),
            ),
        ),
    )

/** Lays the rows out in columns across `areaWidth`, from y = 0. */
const layoutRows = (
    ctx: Ctx2D,
    rows: ExportLegendRow[],
    areaWidth: number,
    scale: number,
    theme: BandTheme,
): { lines: RowLine[]; height: number } => {
    const cols = columnCount(areaWidth, rows.length, scale)
    const cellWidth = Math.max(
        0,
        Math.floor((areaWidth - (cols - 1) * COL_GAP * scale) / cols),
    )
    const lines: RowLine[] = []
    let y = 0
    for (let i = 0; i < rows.length; i += cols) {
        if (i > 0) y += ROW_GAP * scale
        const cells = rows
            .slice(i, i + cols)
            .map((row, c) =>
                cellOf(
                    ctx,
                    row,
                    c * (cellWidth + COL_GAP * scale),
                    cellWidth,
                    scale,
                    theme,
                ),
            )
        const height = Math.max(...cells.map((cell) => cell.height))
        lines.push({ y, height, cells })
        y += height
    }
    return { lines, height: y }
}

const layoutBand = (
    ctx: Ctx2D,
    model: ExportLegendModel,
    width: number,
    scale: number,
    theme: BandTheme,
): Layout => {
    const rule = ruleOf(scale)
    const pad = PAD * scale
    const innerWidth = Math.max(0, width - 2 * pad)
    const headerLines = headerLinesOf(model, theme)

    if (headerLines.length === 0) {
        const rows = layoutRows(ctx, model.rows, innerWidth, scale, theme)
        return {
            rule,
            pad,
            header: [],
            divider: null,
            rowsX: 0,
            rowsY: 0,
            lines: rows.lines,
            bandHeight: rows.height + 2 * pad,
        }
    }

    if (innerWidth >= SIDE_HEADER_MIN_WIDTH * scale) {
        // The header in a column of its own, a vertical hairline, then the
        // rows: the header never lines up with a row as if it were one.
        const maxWidth = Math.floor(innerWidth * HEADER_COL_MAX_SHARE)
        const headerWidth = Math.min(
            maxWidth,
            Math.ceil(headerNaturalWidth(ctx, headerLines, scale, theme)),
        )
        // Whole px, so the rows start on a whole logical pixel.
        const spare = (maxWidth - headerWidth) / scale
        const gap =
            Math.round(
                Math.min(
                    SIDE_GAP_MAX,
                    SIDE_GAP_MIN + spare * SIDE_GAP_SPARE_SHARE,
                ),
            ) * scale
        const header = wrapHeader(ctx, headerLines, headerWidth, scale, theme)
        const headH = headerHeight(header, scale)
        const rowsX = headerWidth + 2 * gap + rule
        const rows = layoutRows(
            ctx,
            model.rows,
            innerWidth - rowsX,
            scale,
            theme,
        )
        const contentH = Math.max(headH, rows.height)
        return {
            rule,
            pad,
            header,
            divider: { x: headerWidth + gap, y: 0, w: rule, h: contentH },
            rowsX,
            rowsY: 0,
            lines: rows.lines,
            bandHeight: contentH + 2 * pad,
        }
    }

    // Too narrow for a header column: the header on top, a full-width
    // hairline, then the rows.
    const gap = SECTION_GAP * scale
    const header = wrapHeader(ctx, headerLines, innerWidth, scale, theme)
    const headH = headerHeight(header, scale)
    const rowsY = headH + 2 * gap + rule
    const rows = layoutRows(ctx, model.rows, innerWidth, scale, theme)
    return {
        rule,
        pad,
        header,
        divider: { x: 0, y: headH + gap, w: innerWidth, h: rule },
        rowsX: 0,
        rowsY,
        lines: rows.lines,
        bandHeight: rowsY + rows.height + 2 * pad,
    }
}

export const measureLegendBand = (
    ctx: Ctx2D,
    model: ExportLegendModel,
    width: number,
    scale: number,
    theme: BandTheme = DEFAULT_BAND_THEME,
): number => {
    if (model.rows.length === 0) return 0
    return Math.ceil(layoutBand(ctx, model, width, scale, theme).bandHeight)
}

/** Fills a box with `color`, edged with a hairline when the color is too
 *  pale to hold an edge against the band on its own. */
const fillSwatch = (
    ctx: Ctx2D,
    color: string,
    pale: boolean,
    x: number,
    y: number,
    size: number,
    rule: number,
    theme: BandTheme,
) => {
    if (pale) {
        ctx.fillStyle = theme.hairline
        ctx.fillRect(x, y, size, size)
        ctx.fillStyle = color
        ctx.fillRect(x + rule, y + rule, size - 2 * rule, size - 2 * rule)
        return
    }
    ctx.fillStyle = color
    ctx.fillRect(x, y, size, size)
}

const paintRamp = (
    ctx: Ctx2D,
    colors: string[] | null,
    x: number,
    y: number,
    w: number,
    h: number,
    rule: number,
    theme: BandTheme,
) => {
    // A blank stop color (a legend entry with no color) would throw inside
    // addColorStop and fail the whole band away, so it takes the same
    // neutral the categorical path uses for a missing color.
    const ramp = (colors && colors.length > 0 ? colors : NEUTRAL_RAMP).map(
        (color) => color || FALLBACK_SWATCH,
    )
    // Only the ends can meet the band's white edge-on, so only they decide
    // whether the bar needs a hairline to stay visible.
    if (isPale(ctx, ramp[0]) || isPale(ctx, ramp[ramp.length - 1])) {
        ctx.fillStyle = theme.hairline
        ctx.fillRect(x, y, w, h)
        x += rule
        y += rule
        w -= 2 * rule
        h -= 2 * rule
    }
    if (ramp.length === 1) {
        ctx.fillStyle = ramp[0]
    } else {
        const grad = ctx.createLinearGradient(x, y, x + w, y)
        ramp.forEach((color, i) =>
            grad.addColorStop(i / (ramp.length - 1), color),
        )
        ctx.fillStyle = grad
    }
    ctx.fillRect(x, y, w, h)
}

/**
 * Draws a bound's number in regular weight and its unit in light, left- or
 * right-aligned at `x`, clipped as one label to `maxWidth`. Draws nothing for
 * a blank bound.
 */
const drawBound = (
    ctx: Ctx2D,
    value: number | null,
    unit: string | null,
    x: number,
    y: number,
    maxWidth: number,
    align: 'left' | 'right',
    minX: number,
    scale: number,
    theme: BandTheme,
) => {
    const text = boundValue(value)
    if (!text) return
    const regular = FONT(LABEL_TEXT, scale, theme.weights.regular, theme)
    const light = FONT(LABEL_TEXT, scale, theme.weights.light, theme)
    ctx.fillStyle = theme.muted
    ctx.font = regular
    const textW = ctx.measureText(text).width
    let unitText = unit ? ` ${unit}` : ''
    ctx.font = light
    let unitW = unitText ? ctx.measureText(unitText).width : 0
    if (textW + unitW > maxWidth) {
        // Too long to print whole: keep the number and clip the unit, or
        // clip the number itself when even it doesn't fit.
        if (textW >= maxWidth) {
            ctx.font = regular
            const clipped = clipText(ctx, text, maxWidth)
            const w = ctx.measureText(clipped).width
            ctx.fillText(
                clipped,
                align === 'left' ? x : Math.max(minX, x - w),
                y,
            )
            return
        }
        unitText = clipText(ctx, unitText, maxWidth - textW)
        unitW = ctx.measureText(unitText).width
    }
    const left = align === 'left' ? x : Math.max(minX, x - textW - unitW)
    ctx.font = regular
    ctx.fillText(text, left, y)
    if (unitText) {
        ctx.font = light
        ctx.fillText(unitText, left + textW, y)
    }
}

const drawCell = (
    ctx: Ctx2D,
    cell: Cell,
    x: number,
    y: number,
    rule: number,
    scale: number,
    theme: BandTheme,
) => {
    const { row } = cell
    ctx.fillStyle = theme.ink
    ctx.font = FONT(ROW_TITLE_TEXT, scale, theme.weights.regular, theme)
    ctx.fillText(clipText(ctx, row.title, cell.width), x, y)
    if (row.dateLine) {
        ctx.fillStyle = theme.muted
        ctx.font = FONT(META_TEXT, scale, theme.weights.regular, theme)
        ctx.fillText(
            clipText(ctx, row.dateLine, cell.width),
            x,
            y + (ROW_TITLE_TEXT + LINE_GAP) * scale,
        )
    }
    if (row.kind === 'plain') return
    const bodyY = y + rowHeadHeight(row, scale) + BODY_GAP * scale

    if (row.kind === 'gradient') {
        const barW = Math.min(BAR_WIDTH * scale, cell.width)
        paintRamp(
            ctx,
            row.colors,
            x,
            bodyY,
            barW,
            BAR_HEIGHT * scale,
            rule,
            theme,
        )
        const boundsY = bodyY + (BAR_HEIGHT + LINE_GAP) * scale
        // Each bound is capped at half the bar less half the gap, so a long
        // min and a long max are clipped rather than colliding, and the
        // right-aligned max is clamped to the bar's left edge so it can never
        // start off-canvas.
        const boundMaxWidth = Math.max(0, barW / 2 - (BOUND_GAP / 2) * scale)
        drawBound(
            ctx,
            row.min,
            row.unit,
            x,
            boundsY,
            boundMaxWidth,
            'left',
            x,
            scale,
            theme,
        )
        drawBound(
            ctx,
            row.max,
            row.unit,
            x + barW,
            boundsY,
            boundMaxWidth,
            'right',
            x,
            scale,
            theme,
        )
        return
    }

    for (const item of cell.items) {
        const sx = x + item.dx
        const sy = bodyY + item.line * (SWATCH + LINE_GAP) * scale
        fillSwatch(
            ctx,
            item.color,
            item.pale,
            sx,
            sy,
            SWATCH * scale,
            rule,
            theme,
        )
        ctx.fillStyle = theme.muted
        ctx.font = FONT(LABEL_TEXT, scale, theme.weights.light, theme)
        ctx.fillText(item.label, sx + (SWATCH + SWATCH_GAP) * scale, sy + scale)
    }
}

export const drawLegendBand = (
    ctx: Ctx2D,
    model: ExportLegendModel,
    width: number,
    yTop: number,
    bandHeight: number,
    scale: number,
    theme: BandTheme = DEFAULT_BAND_THEME,
): void => {
    const layout = layoutBand(ctx, model, width, scale, theme)
    const { rule, pad } = layout
    const left = pad
    const top = yTop + pad
    ctx.save()
    ctx.textBaseline = 'top'

    ctx.fillStyle = theme.surface
    ctx.fillRect(0, yTop, width, bandHeight)

    let y = top
    for (const block of layout.header) {
        y += block.gapBefore * scale
        ctx.fillStyle = block.color
        ctx.font = fontOf(block, scale, theme)
        block.wrapped.forEach((text, i) => {
            if (i > 0) y += LINE_GAP * scale
            ctx.fillText(text, left, y)
            y += block.size * scale
        })
    }

    if (layout.divider) {
        const { x: dx, y: dy, w, h } = layout.divider
        ctx.fillStyle = theme.hairline
        ctx.fillRect(left + dx, top + dy, w, h)
    }

    for (const line of layout.lines) {
        for (const cell of line.cells) {
            drawCell(
                ctx,
                cell,
                left + layout.rowsX + cell.x,
                top + layout.rowsY + line.y,
                rule,
                scale,
                theme,
            )
        }
    }
    ctx.restore()
}
