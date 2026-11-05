import { DEFAULT_BAND_THEME, type BandTheme } from './bandTheme'
import type { ExportCompass, ExportScaleBar } from '../adapters/mmgisAPI'

// Draws an export's scale bar and north arrow. Metrics are logical pixels
// times `scale`, except `bar.widthPx`, which is already in image pixels.

export const SCALE_BAR_MARGIN = 12
const PAD_X = 8
const PAD_Y = 6
const LABEL_TEXT = 12
const LABEL_GAP = 4
const LABEL_INDENT = 8
const TICK = 8
const BACKING = 'rgba(255, 255, 255, 0.8)'

type Ctx2D = Pick<CanvasRenderingContext2D, 'fillRect' | 'fillText' | 'measureText'> & {
    fillStyle: unknown
    font: string
    textBaseline: CanvasTextBaseline
}

type ArrowCtx2D = Ctx2D &
    Pick<
        CanvasRenderingContext2D,
        'save' | 'restore' | 'translate' | 'rotate' | 'beginPath' | 'moveTo' | 'lineTo' | 'closePath' | 'fill'
    > & { textAlign: CanvasTextAlign }

/** The north arrow's backing box, a square of this many logical pixels. */
export const NORTH_ARROW_SIZE = 36
const ARROW_HALF_WIDTH = 6
const ARROW_LENGTH = 14
const NORTH_TEXT = 10

const ruleOf = (scale: number): number => Math.max(2, Math.round(2 * scale))

/** The backing box's size, in image pixels. */
export const measureScaleBar = (
    ctx: Ctx2D,
    bar: ExportScaleBar,
    scale: number,
    theme: BandTheme = DEFAULT_BAND_THEME,
): { width: number; height: number } => {
    ctx.font = `${theme.weights.semibold} ${Math.round(LABEL_TEXT * scale)}px ${theme.family}`
    const labelWidth = ctx.measureText(bar.label).width + LABEL_INDENT * scale
    const rule = ruleOf(scale)
    return {
        width: Math.max(bar.widthPx + rule, labelWidth) + 2 * PAD_X * scale,
        height: (2 * PAD_Y + LABEL_TEXT + LABEL_GAP + TICK) * scale + rule,
    }
}

/** Draws the bar with its backing's bottom-left corner at (`left`, `bottom`). */
export const drawScaleBar = (
    ctx: Ctx2D,
    bar: ExportScaleBar,
    opts: { left: number; bottom: number; scale: number; theme?: BandTheme },
): void => {
    const { left, bottom, scale, theme = DEFAULT_BAND_THEME } = opts
    const { width, height } = measureScaleBar(ctx, bar, scale, theme)
    const top = bottom - height
    const rule = ruleOf(scale)

    ctx.fillStyle = BACKING
    ctx.fillRect(left, top, width, height)

    const x = left + PAD_X * scale
    const ruleTop = bottom - PAD_Y * scale - rule
    const tick = TICK * scale
    ctx.fillStyle = theme.ink
    ctx.fillRect(x, ruleTop, bar.widthPx, rule)
    ctx.fillRect(x, ruleTop - tick, rule, tick + rule)
    ctx.fillRect(x + bar.widthPx - rule, ruleTop - tick, rule, tick + rule)

    ctx.font = `${theme.weights.semibold} ${Math.round(LABEL_TEXT * scale)}px ${theme.family}`
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(bar.label, x + LABEL_INDENT * scale, ruleTop - tick - LABEL_GAP * scale)
}

/**
 * Draws a north arrow in a square backing with its bottom-left corner at
 * (`left`, `bottom`). The arrow turns against the bearing, so its tip points
 * to geographic north as the captured map shows it; an "N" sits above the tip.
 */
export const drawNorthArrow = (
    ctx: ArrowCtx2D,
    compass: ExportCompass,
    opts: { left: number; bottom: number; scale: number; theme?: BandTheme },
): void => {
    const { left, bottom, scale, theme = DEFAULT_BAND_THEME } = opts
    const size = NORTH_ARROW_SIZE * scale
    const top = bottom - size
    ctx.fillStyle = BACKING
    ctx.fillRect(left, top, size, size)

    ctx.save()
    ctx.translate(left + size / 2, top + size / 2)
    ctx.rotate((-compass.bearing * Math.PI) / 180)
    const half = ARROW_HALF_WIDTH * scale
    const length = ARROW_LENGTH * scale
    const text = Math.round(NORTH_TEXT * scale)
    // The tip sits above the centre, with the "N" above it; both are drawn
    // in the rotated frame so they turn together.
    const tipY = -length / 2 + text / 2
    ctx.fillStyle = theme.ink
    ctx.beginPath()
    ctx.moveTo(0, tipY)
    ctx.lineTo(half, tipY + length)
    ctx.lineTo(-half, tipY + length)
    ctx.closePath()
    ctx.fill()
    ctx.font = `${theme.weights.semibold} ${text}px ${theme.family}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText('N', 0, tipY - 2 * scale)
    ctx.restore()
}
