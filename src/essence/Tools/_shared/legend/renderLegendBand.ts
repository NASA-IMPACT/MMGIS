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

const rowHeight = (row: ExportLegendRow, scale: number): number => {
    if (row.kind === 'gradient') {
        return (
            (TITLE_TEXT + LINE_GAP + BAR_HEIGHT + LINE_GAP + LABEL_TEXT) *
            scale
        )
    }
    // Categorical: title line + one swatch line (swatches wrap at draw time;
    // wrapping adds lines, so measure with the same wrap the draw pass uses).
    return (TITLE_TEXT + LINE_GAP + SWATCH) * scale
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
    if (model.missionName || model.timeLabel) {
        h += (HEADER_TEXT + ROW_GAP) * scale
    }
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
        // A blank stop color (buildGradientFields' `entry.color || ''`) would
        // throw here and fail the whole band away — fall back to the same
        // neutral swatch the categorical path uses for a missing color.
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
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, yTop, width, bandHeight)
    ctx.fillStyle = '#d0d0d0'
    ctx.fillRect(0, yTop, width, Math.max(1, Math.round(scale)))

    const left = PAD * scale
    const textMaxWidth = width - 2 * left
    let y = yTop + PAD * scale

    const header = [model.missionName, model.timeLabel].filter(Boolean).join('  ·  ')
    if (header) {
        ctx.fillStyle = '#111111'
        ctx.font = FONT(HEADER_TEXT, scale, 'bold')
        ctx.fillText(clipText(ctx, header, textMaxWidth), left, y)
        y += (HEADER_TEXT + ROW_GAP) * scale
    }

    for (const row of model.rows) {
        ctx.fillStyle = '#111111'
        ctx.font = FONT(TITLE_TEXT, scale, 'bold')
        ctx.fillText(clipText(ctx, row.title, textMaxWidth), left, y)
        y += (TITLE_TEXT + LINE_GAP) * scale

        if (row.kind === 'gradient') {
            const barW = Math.min(BAR_WIDTH * scale, width - 2 * left)
            paintRamp(ctx, row.colors, left, y, barW, BAR_HEIGHT * scale)
            y += (BAR_HEIGHT + LINE_GAP) * scale
            ctx.fillStyle = '#444444'
            ctx.font = FONT(LABEL_TEXT, scale)
            ctx.fillText(formatLegendBound(row.min, row.unit), left, y)
            const maxLabel = formatLegendBound(row.max, row.unit)
            const maxW = ctx.measureText(maxLabel).width
            ctx.fillText(maxLabel, left + barW - maxW, y)
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
