import type { ExportLegendModel, ExportLegendRow } from './getExportLegendModel'

// All metrics are logical px, multiplied by `scale` at layout time so the
// band stays proportionate to hi-DPI captures (capture size follows
// devicePixelRatio). Measure and draw both read the one layout `layoutBand`
// builds, so every constant reaches both passes through the same numbers.

// The band is a framed panel: a margin of band background around a bordered
// white card, padded inside.
const FRAME_INSET = 12
const PAD = 16
// Type sizes, largest to smallest: the mission title, row titles, then the
// metadata and bound labels.
const TITLE_TEXT = 16
const ROW_TITLE_TEXT = 13
const META_TEXT = 11
const LABEL_TEXT = 11
// Space between stacked lines of one text block.
const LINE_GAP = 5
// Clear space either side of the rule that parts the header from the rows.
const SECTION_GAP = 12
// Clear space either side of the rule between two lines of rows.
const ROW_GAP = 12
// Space between a row's text and its ramp or swatches.
const BODY_GAP = 8
const BAR_HEIGHT = 12
const BAR_WIDTH = 260
const SWATCH = 12
// Swatch-to-label and item-to-item spacing on a swatch line.
const SWATCH_GAP = 6
const ITEM_GAP = 16
// Clear space kept between a gradient bar's two bound labels.
const BOUND_GAP = 10
// Rows flow into columns once the panel is wide enough to hold more than one
// column of at least MIN_COL_WIDTH.
const COL_GAP = 24
const MIN_COL_WIDTH = 260
const MAX_COLS = 3

// A neutral, print-friendly palette independent of the app theme: an
// exported PNG/PDF is a shareable artifact, not a UI surface, and no theme
// token reaches a canvas anyway.
const BAND_BG = '#f4f4f4'
const PANEL_BG = '#ffffff'
const INK = '#1a1a1a'
const MUTED = '#5c5c5c'
const ACCENT = '#c6c6c6'
const NEUTRAL_RAMP = ['#bdbdbd', '#757575']
const FALLBACK_SWATCH = '#bdbdbd'
const FAMILY = '"Helvetica Neue", Helvetica, Arial, sans-serif'

const FONT = (px: number, scale: number, weight = '') =>
    `${weight ? `${weight} ` : ''}${Math.round(px * scale)}px ${FAMILY}`

// Hairlines (the frame, the rules, the ramp and swatch outlines) are one
// device pixel per unit of scale so they read the same at every DPR.
const ruleOf = (scale: number): number => Math.max(1, Math.round(scale))

/**
 * A bound as its label: three significant figures, exponential for the
 * magnitudes that would otherwise run past the bar, and blank for a bound the
 * layer never declared — a legend prints nothing rather than inventing a 0.
 */
const boundLabel = (value: number | null, unit: string | null): string => {
    if (value == null || !Number.isFinite(value)) return ''
    const magnitude = Math.abs(value)
    const text =
        value !== 0 && (magnitude >= 9999 || magnitude < 0.001)
            ? value.toExponential(2)
            : String(parseFloat(value.toFixed(3)))
    return unit ? `${text} ${unit}` : text
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

// The header's lines in draw order: the mission name, then whatever the
// model worded — the renderer prints them without knowing what any of them
// says.
type HeaderLine = { text: string; size: number; weight: string; color: string }

const headerLinesOf = (model: ExportLegendModel): HeaderLine[] => {
    const lines: HeaderLine[] = []
    if (model.missionName) {
        lines.push({
            text: model.missionName,
            size: TITLE_TEXT,
            weight: 'bold',
            color: INK,
        })
    }
    for (const text of model.headerLines) {
        lines.push({ text, size: META_TEXT, weight: '', color: MUTED })
    }
    return lines
}

const headerHeight = (lines: HeaderLine[], scale: number): number =>
    lines.reduce(
        (h, line, i) => h + (i > 0 ? LINE_GAP * scale : 0) + line.size * scale,
        0,
    )

/** One swatch and its label, placed relative to its cell's top-left. */
type CategoryItem = { label: string; color: string; dx: number; line: number }

/** One row placed in the grid: its column offset and width, its height, and
 *  for a categorical row the swatches already wrapped to that width. */
type Cell = {
    row: ExportLegendRow
    x: number
    width: number
    height: number
    items: CategoryItem[]
}

/** One horizontal line of cells; `y` is relative to the content top. */
type RowLine = { y: number; height: number; cells: Cell[] }

type Layout = {
    rule: number
    /** Band edge to panel content: the frame's inset, border and padding. */
    edge: number
    innerWidth: number
    header: HeaderLine[]
    lines: RowLine[]
    bandHeight: number
}

const wrapCategorical = (
    ctx: Ctx2D,
    stops: { color: string; label: string }[],
    cellWidth: number,
    scale: number,
): CategoryItem[] => {
    ctx.font = FONT(LABEL_TEXT, scale)
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
        items.push({
            label,
            color: stop.color || FALLBACK_SWATCH,
            dx: x,
            line,
        })
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
): Cell => {
    const head = ROW_TITLE_TEXT * scale
    if (row.kind === 'gradient') {
        const body = (BODY_GAP + BAR_HEIGHT + LINE_GAP + LABEL_TEXT) * scale
        return { row, x, width, height: head + body, items: [] }
    }
    if (row.kind === 'plain') {
        // A name alone: there is no graphic under it to leave room for.
        return { row, x, width, height: head, items: [] }
    }
    const items = wrapCategorical(ctx, row.stops, width, scale)
    const lines = items.length > 0 ? items[items.length - 1].line + 1 : 1
    const body =
        BODY_GAP * scale +
        lines * SWATCH * scale +
        (lines - 1) * LINE_GAP * scale
    return { row, x, width, height: head + body, items }
}

const columnCount = (innerWidth: number, rows: number, scale: number): number =>
    Math.max(
        1,
        Math.min(
            MAX_COLS,
            rows,
            Math.floor(
                (innerWidth + COL_GAP * scale) /
                    ((MIN_COL_WIDTH + COL_GAP) * scale),
            ),
        ),
    )

const layoutBand = (
    ctx: Ctx2D,
    model: ExportLegendModel,
    width: number,
    scale: number,
): Layout => {
    const rule = ruleOf(scale)
    const edge = FRAME_INSET * scale + rule + PAD * scale
    const innerWidth = Math.max(0, width - 2 * edge)

    const header = headerLinesOf(model)
    const rowsTop =
        header.length > 0
            ? headerHeight(header, scale) + 2 * SECTION_GAP * scale + rule
            : 0

    const cols = columnCount(innerWidth, model.rows.length, scale)
    const cellWidth = Math.max(
        0,
        Math.floor((innerWidth - (cols - 1) * COL_GAP * scale) / cols),
    )

    const lines: RowLine[] = []
    let y = rowsTop
    for (let i = 0; i < model.rows.length; i += cols) {
        if (i > 0) y += 2 * ROW_GAP * scale + rule
        const cells = model.rows
            .slice(i, i + cols)
            .map((row, c) =>
                cellOf(
                    ctx,
                    row,
                    c * (cellWidth + COL_GAP * scale),
                    cellWidth,
                    scale,
                ),
            )
        const height = Math.max(...cells.map((cell) => cell.height))
        lines.push({ y, height, cells })
        y += height
    }

    return {
        rule,
        edge,
        innerWidth,
        header,
        lines,
        bandHeight: y + 2 * edge,
    }
}

export const measureLegendBand = (
    ctx: Ctx2D,
    model: ExportLegendModel,
    width: number,
    scale: number,
): number => {
    if (model.rows.length === 0) return 0
    return Math.ceil(layoutBand(ctx, model, width, scale).bandHeight)
}

/** Paints a hairline frame and returns the box inside it, so a pale ramp or
 *  swatch keeps an edge against the white panel. */
const outlineRect = (
    ctx: Ctx2D,
    x: number,
    y: number,
    w: number,
    h: number,
    rule: number,
) => {
    ctx.fillStyle = ACCENT
    ctx.fillRect(x, y, w, h)
    return { x: x + rule, y: y + rule, w: w - 2 * rule, h: h - 2 * rule }
}

const paintRamp = (
    ctx: Ctx2D,
    colors: string[] | null,
    x: number,
    y: number,
    w: number,
    h: number,
) => {
    const ramp = colors && colors.length > 0 ? colors : NEUTRAL_RAMP
    if (ramp.length === 1) {
        ctx.fillStyle = ramp[0]
    } else {
        const grad = ctx.createLinearGradient(x, y, x + w, y)
        // A blank stop color (a legend entry with no color) would throw here
        // and fail the whole band away — fall back to the same neutral swatch
        // the categorical path uses for a missing color.
        ramp.forEach((color, i) =>
            grad.addColorStop(i / (ramp.length - 1), color || FALLBACK_SWATCH),
        )
        ctx.fillStyle = grad
    }
    ctx.fillRect(x, y, w, h)
}

const drawRule = (
    ctx: Ctx2D,
    x: number,
    y: number,
    w: number,
    rule: number,
) => {
    ctx.fillStyle = ACCENT
    ctx.fillRect(x, y, w, rule)
}

const drawCell = (
    ctx: Ctx2D,
    cell: Cell,
    x: number,
    y: number,
    rule: number,
    scale: number,
) => {
    const { row } = cell
    ctx.fillStyle = INK
    ctx.font = FONT(ROW_TITLE_TEXT, scale, 'bold')
    ctx.fillText(clipText(ctx, row.title, cell.width), x, y)
    if (row.kind === 'plain') return
    const bodyY = y + ROW_TITLE_TEXT * scale + BODY_GAP * scale

    if (row.kind === 'gradient') {
        const barW = Math.min(BAR_WIDTH * scale, cell.width)
        const inner = outlineRect(ctx, x, bodyY, barW, BAR_HEIGHT * scale, rule)
        paintRamp(ctx, row.colors, inner.x, inner.y, inner.w, inner.h)
        const boundsY = bodyY + (BAR_HEIGHT + LINE_GAP) * scale
        ctx.fillStyle = MUTED
        ctx.font = FONT(LABEL_TEXT, scale)
        // Each bound is capped at half the bar less half the gap, so a long
        // min and a long max are clipped rather than colliding, and the
        // right-aligned max is clamped to the bar's left edge so it can never
        // start off-canvas.
        const boundMaxWidth = Math.max(0, barW / 2 - (BOUND_GAP / 2) * scale)
        const minLabel = clipText(
            ctx,
            boundLabel(row.min, row.unit),
            boundMaxWidth,
        )
        const maxLabel = clipText(
            ctx,
            boundLabel(row.max, row.unit),
            boundMaxWidth,
        )
        ctx.fillText(minLabel, x, boundsY)
        const maxW = ctx.measureText(maxLabel).width
        ctx.fillText(maxLabel, Math.max(x, x + barW - maxW), boundsY)
        return
    }

    for (const item of cell.items) {
        const sx = x + item.dx
        const sy = bodyY + item.line * (SWATCH + LINE_GAP) * scale
        const inner = outlineRect(
            ctx,
            sx,
            sy,
            SWATCH * scale,
            SWATCH * scale,
            rule,
        )
        ctx.fillStyle = item.color
        ctx.fillRect(inner.x, inner.y, inner.w, inner.h)
        ctx.fillStyle = MUTED
        ctx.font = FONT(LABEL_TEXT, scale)
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
): void => {
    const layout = layoutBand(ctx, model, width, scale)
    const { rule, edge, innerWidth } = layout
    const left = edge
    const top = yTop + edge
    ctx.save()
    ctx.textBaseline = 'top'

    // The frame: the band's margin, the panel's border, then the panel
    // over it.
    const inset = FRAME_INSET * scale
    ctx.fillStyle = BAND_BG
    ctx.fillRect(0, yTop, width, bandHeight)
    ctx.fillStyle = ACCENT
    ctx.fillRect(inset, yTop + inset, width - 2 * inset, bandHeight - 2 * inset)
    ctx.fillStyle = PANEL_BG
    ctx.fillRect(
        inset + rule,
        yTop + inset + rule,
        width - 2 * (inset + rule),
        bandHeight - 2 * (inset + rule),
    )

    let y = top
    layout.header.forEach((line, i) => {
        if (i > 0) y += LINE_GAP * scale
        ctx.fillStyle = line.color
        ctx.font = FONT(line.size, scale, line.weight)
        ctx.fillText(clipText(ctx, line.text, innerWidth), left, y)
        y += line.size * scale
    })
    if (layout.header.length > 0) {
        drawRule(ctx, left, y + SECTION_GAP * scale, innerWidth, rule)
    }

    layout.lines.forEach((line, i) => {
        const lineTop = top + line.y
        if (i > 0) {
            drawRule(
                ctx,
                left,
                lineTop - ROW_GAP * scale - rule,
                innerWidth,
                rule,
            )
        }
        for (const cell of line.cells) {
            drawCell(ctx, cell, left + cell.x, lineTop, rule, scale)
        }
    })
    ctx.restore()
}
