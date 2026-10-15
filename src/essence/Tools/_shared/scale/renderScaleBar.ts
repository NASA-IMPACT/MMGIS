import { DEFAULT_BAND_THEME, type BandTheme } from '../legend/bandTheme'
import type { ScaleBarModel } from './scaleBarModel'

// Draws the export's scale bar. Metrics are logical pixels times `scale`,
// except `model.widthPx`, which is already in image pixels.

export const SCALE_BAR_MARGIN = 12
const PAD_X = 8
const PAD_Y = 6
const LABEL_TEXT = 12
const LABEL_GAP = 4
const LABEL_INDENT = 4
const TICK = 8
const BACKING = 'rgba(255, 255, 255, 0.8)'

type Ctx2D = Pick<CanvasRenderingContext2D, 'fillRect' | 'fillText' | 'measureText'> & {
    fillStyle: unknown
    font: string
    textBaseline: CanvasTextBaseline
}

const ruleOf = (scale: number): number => Math.max(2, Math.round(2 * scale))

/** The backing box's size, in image pixels. */
export const measureScaleBar = (
    ctx: Ctx2D,
    model: ScaleBarModel,
    scale: number,
    theme: BandTheme = DEFAULT_BAND_THEME,
): { width: number; height: number } => {
    ctx.font = `${theme.weights.semibold} ${Math.round(LABEL_TEXT * scale)}px ${theme.family}`
    const labelWidth = ctx.measureText(model.label).width + LABEL_INDENT * scale
    const rule = ruleOf(scale)
    return {
        width: Math.max(model.widthPx + rule, labelWidth) + 2 * PAD_X * scale,
        height:
            (2 * PAD_Y + LABEL_TEXT + LABEL_GAP + TICK) * scale + rule,
    }
}

/**
 * Draws the bar with its backing's bottom-left corner at (`left`, `bottom`).
 */
export const drawScaleBar = (
    ctx: Ctx2D,
    model: ScaleBarModel,
    opts: { left: number; bottom: number; scale: number; theme?: BandTheme },
): void => {
    const { left, bottom, scale, theme = DEFAULT_BAND_THEME } = opts
    const { width, height } = measureScaleBar(ctx, model, scale, theme)
    const top = bottom - height
    const rule = ruleOf(scale)

    ctx.fillStyle = BACKING
    ctx.fillRect(left, top, width, height)

    const x = left + PAD_X * scale
    const ruleTop = bottom - PAD_Y * scale - rule
    const tick = TICK * scale
    ctx.fillStyle = theme.ink
    ctx.fillRect(x, ruleTop, model.widthPx, rule)
    ctx.fillRect(x, ruleTop - tick, rule, tick + rule)
    ctx.fillRect(x + model.widthPx - rule, ruleTop - tick, rule, tick + rule)

    ctx.font = `${theme.weights.semibold} ${Math.round(LABEL_TEXT * scale)}px ${theme.family}`
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(model.label, x + LABEL_INDENT * scale, ruleTop - tick - LABEL_GAP * scale)
}
