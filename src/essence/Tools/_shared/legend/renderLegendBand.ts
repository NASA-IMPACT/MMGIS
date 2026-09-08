import { formatLegendBound } from './format'
import type { ExportLegendModel, ExportLegendRow } from './getExportLegendModel'

// All metrics are logical px, multiplied by `scale` at draw time so the band
// stays proportionate to hi-DPI captures (capture size follows
// devicePixelRatio).
const PAD = 16
const HEADER_TEXT = 15
const TITLE_TEXT = 13
const LABEL_TEXT = 11
const BAR_HEIGHT = 12
const BAR_WIDTH = 260
const SWATCH = 12
const LINE_GAP = 6
const ROW_GAP = 14
// Clear space kept between a gradient bar's two bound labels.
const BOUND_GAP = 10
const NEUTRAL_RAMP = ['#bdbdbd', '#757575']

const FONT = (px: number, scale: number, weight = '') =>
    `${weight ? `${weight} ` : ''}${Math.round(px * scale)}px sans-serif`

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
            size: HEADER_TEXT,
            weight: 'bold',
            color: '#111111',
        })
    }
    for (const text of model.headerLines) {
        lines.push({ text, size: LABEL_TEXT, weight: '', color: '#444444' })
    }
    return lines
}

const headerHeight = (lines: HeaderLine[], scale: number): number =>
    lines.length === 0
        ? 0
        : lines.reduce(
              (h, line, i) =>
                  h + (i > 0 ? LINE_GAP * scale : 0) + line.size * scale,
              0,
          ) + ROW_GAP * scale

// The line a row's date occupies under its title, for the rows that carry
// one — the draw pass advances by exactly this much before the row's body,
// so measure and draw agree on where the row ends.
const dateLineHeight = (row: ExportLegendRow, scale: number): number =>
    row.dateLine ? (LINE_GAP + LABEL_TEXT) * scale : 0

const rowHeight = (row: ExportLegendRow, scale: number): number => {
    const head = TITLE_TEXT * scale + dateLineHeight(row, scale)
    if (row.kind === 'gradient') {
        return head + (LINE_GAP + BAR_HEIGHT + LINE_GAP + LABEL_TEXT) * scale
    }
    // A plain row is its title and its date line: there is no graphic under
    // them to leave room for.
    if (row.kind === 'plain') return head
    // Categorical: title line + one swatch line (swatches wrap at draw time;
    // wrapping adds lines, so measure with the same wrap the draw pass uses).
    return head + (LINE_GAP + SWATCH) * scale
}

// The widest a single category label can render, clipped so that even alone
// on a fresh line it can't overflow the row — the same cap `wrapCategorical`
// (measure) and the draw loop apply, so wrapping agrees between the two.
const categoryLabelMaxWidth = (width: number, scale: number): number =>
    width - 2 * PAD * scale - (SWATCH + 6) * scale - 16 * scale

const wrapCategorical = (
    ctx: Ctx2D,
    row: Extract<ExportLegendRow, { kind: 'categorical' }>,
    width: number,
    scale: number,
): { lines: number } => {
    ctx.font = FONT(LABEL_TEXT, scale)
    const maxX = width - PAD * scale
    const labelMaxWidth = categoryLabelMaxWidth(width, scale)
    let x = PAD * scale
    let lines = 1
    for (const stop of row.stops) {
        const label = clipText(ctx, stop.label, labelMaxWidth)
        const itemW =
            (SWATCH + 6) * scale + ctx.measureText(label).width + 16 * scale
        if (x + itemW > maxX && x > PAD * scale) {
            lines += 1
            x = PAD * scale
        }
        x += itemW
    }
    return { lines }
}

export const measureLegendBand = (
    ctx: Ctx2D,
    model: ExportLegendModel,
    width: number,
    scale: number,
): number => {
    if (model.rows.length === 0) return 0
    let h = PAD * scale
    h += headerHeight(headerLinesOf(model), scale)
    for (const row of model.rows) {
        h += rowHeight(row, scale)
        if (row.kind === 'categorical') {
            const { lines } = wrapCategorical(ctx, row, width, scale)
            h += (lines - 1) * (SWATCH + LINE_GAP) * scale
        }
        h += ROW_GAP * scale
    }
    return Math.ceil(h + (PAD - ROW_GAP) * scale)
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
            grad.addColorStop(i / (ramp.length - 1), color || '#bdbdbd'),
        )
        ctx.fillStyle = grad
    }
    ctx.fillRect(x, y, w, h)
}

export const drawLegendBand = (
    ctx: Ctx2D,
    model: ExportLegendModel,
    width: number,
    yTop: number,
    bandHeight: number,
    scale: number,
): void => {
    ctx.save()
    ctx.textBaseline = 'top'
    // Hardcoded white background with dark text, independent of the app
    // theme: an exported PNG/PDF is a printable/shareable artifact, not a UI
    // surface, so it stays legible and print-friendly regardless of which
    // theme produced it.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, yTop, width, bandHeight)
    ctx.fillStyle = '#d0d0d0'
    ctx.fillRect(0, yTop, width, Math.max(1, Math.round(scale)))

    const left = PAD * scale
    const textMaxWidth = width - 2 * left
    let y = yTop + PAD * scale

    const header = headerLinesOf(model)
    header.forEach((line, i) => {
        if (i > 0) y += LINE_GAP * scale
        ctx.fillStyle = line.color
        ctx.font = FONT(line.size, scale, line.weight)
        ctx.fillText(clipText(ctx, line.text, textMaxWidth), left, y)
        y += line.size * scale
    })
    if (header.length > 0) y += ROW_GAP * scale

    for (const row of model.rows) {
        ctx.fillStyle = '#111111'
        ctx.font = FONT(TITLE_TEXT, scale, 'bold')
        ctx.fillText(clipText(ctx, row.title, textMaxWidth), left, y)
        y += TITLE_TEXT * scale

        if (row.dateLine) {
            y += LINE_GAP * scale
            ctx.fillStyle = '#444444'
            ctx.font = FONT(LABEL_TEXT, scale)
            ctx.fillText(clipText(ctx, row.dateLine, textMaxWidth), left, y)
            y += LABEL_TEXT * scale
        }

        if (row.kind === 'plain') {
            y += ROW_GAP * scale
            continue
        }
        y += LINE_GAP * scale

        if (row.kind === 'gradient') {
            const barW = Math.min(BAR_WIDTH * scale, width - 2 * left)
            paintRamp(ctx, row.colors, left, y, barW, BAR_HEIGHT * scale)
            y += (BAR_HEIGHT + LINE_GAP) * scale
            ctx.fillStyle = '#444444'
            ctx.font = FONT(LABEL_TEXT, scale)
            // Each bound is capped at half the bar less half the gap, so a
            // long min and a long max are clipped rather than colliding, and
            // the right-aligned max is clamped to the bar's left edge so it
            // can never start off-canvas.
            const boundMaxWidth = Math.max(
                0,
                barW / 2 - (BOUND_GAP / 2) * scale,
            )
            const minLabel = clipText(
                ctx,
                formatLegendBound(row.min, row.unit),
                boundMaxWidth,
            )
            const maxLabel = clipText(
                ctx,
                formatLegendBound(row.max, row.unit),
                boundMaxWidth,
            )
            ctx.fillText(minLabel, left, y)
            const maxW = ctx.measureText(maxLabel).width
            ctx.fillText(maxLabel, Math.max(left, left + barW - maxW), y)
            y += LABEL_TEXT * scale
        } else {
            ctx.font = FONT(LABEL_TEXT, scale)
            const maxX = width - left
            const labelMaxWidth = categoryLabelMaxWidth(width, scale)
            let x = left
            for (const stop of row.stops) {
                const label = clipText(ctx, stop.label, labelMaxWidth)
                const labelW = ctx.measureText(label).width
                const itemW = (SWATCH + 6) * scale + labelW + 16 * scale
                if (x + itemW > maxX && x > left) {
                    x = left
                    y += (SWATCH + LINE_GAP) * scale
                }
                ctx.fillStyle = stop.color || '#bdbdbd'
                ctx.fillRect(x, y, SWATCH * scale, SWATCH * scale)
                ctx.fillStyle = '#444444'
                ctx.fillText(label, x + (SWATCH + 6) * scale, y + 1 * scale)
                x += itemW
            }
            y += SWATCH * scale
        }
        y += ROW_GAP * scale
    }
    ctx.restore()
}
