// The arithmetic and the chrome of a comparison screenshot, kept apart from
// the adapter so they can be tested without WebGL: which strip of each
// surface's canvas lands where in the output, and how the divider and the
// captions are painted over it.

import type { ComparisonLayout } from '../IMapEngine'

export type CaptureSide = 'base' | 'left' | 'right'

/** A horizontal strip of one surface's canvas, and where it lands in the output. */
export type CropRect = {
    side: CaptureSide
    /** Source x, in the surface canvas's pixels. */
    sx: number
    /** Strip width, in pixels; the same in source and output. */
    sw: number
    /** Output x. */
    dx: number
}

/**
 * The strips that make up a comparison image `width` pixels wide with the
 * divider at `dividerPos` (0..1), in drawing order.
 *
 * - Swipe: the primary surface spans the whole width (it draws the basemap, or
 *   nothing in standalone mode); the left and right follower canvases share
 *   its camera and are each clipped at the divider, as their `clip-path` is on
 *   screen.
 * - Side-by-side: the left pane's canvas starts at the container's left edge
 *   and shows its leading `pos` of the width; the right pane's canvas starts
 *   at the divider and shows its leading `1 - pos`.
 *
 * A strip with no width is left out.
 */
export function comparisonCropRects(
    layout: ComparisonLayout,
    dividerPos: number,
    width: number,
): CropRect[] {
    const split = Math.round(Math.max(0, Math.min(1, dividerPos)) * width)
    const rects: CropRect[] =
        layout === 'sideBySide'
            ? [
                  { side: 'left', sx: 0, sw: split, dx: 0 },
                  { side: 'right', sx: 0, sw: width - split, dx: split },
              ]
            : [
                  { side: 'base', sx: 0, sw: width, dx: 0 },
                  { side: 'left', sx: 0, sw: split, dx: 0 },
                  { side: 'right', sx: split, sw: width - split, dx: split },
              ]
    return rects.filter((rect) => rect.sw > 0)
}

/** A caption chip as measured on screen, in output pixels. */
export type Caption = {
    text: string
    x: number
    y: number
    width: number
    height: number
}

/** The colours and type the chrome is painted with, read off the theme. */
export type ChromeTheme = {
    rule: string
    disc: string
    chipBackground: string
    chipBorder: string
    ink: string
    family: string
}

// The literal after each token is the value MapComparison.css falls back to.
export const DEFAULT_CHROME_THEME: ChromeTheme = {
    rule: '#ffffff',
    disc: '#005ea2',
    chipBackground: '#ffffff',
    chipBorder: '#dfe1e2',
    ink: '#1c1d1f',
    family: "'Public Sans', system-ui, sans-serif",
}

/** The chrome's tokens off `root`, each falling back to the stylesheet's own value. */
export const resolveChromeTheme = (
    root: Element | null = typeof document !== 'undefined' ? document.documentElement : null,
): ChromeTheme => {
    if (!root || typeof getComputedStyle !== 'function') return DEFAULT_CHROME_THEME
    const style = getComputedStyle(root)
    const token = (name: string, fallback: string): string =>
        style.getPropertyValue(name).trim() || fallback
    const d = DEFAULT_CHROME_THEME
    return {
        rule: token('--theme-color-white', d.rule),
        disc: token('--theme-color-primary', d.disc),
        chipBackground: token('--theme-color-white', d.chipBackground),
        chipBorder: token('--theme-color-base-lighter', d.chipBorder),
        ink: token('--theme-color-ink', d.ink),
        family: token('--theme-font-body', d.family),
    }
}

type ElementLike = {
    textContent: string | null
    getBoundingClientRect(): { left: number; top: number; width: number; height: number }
}
type ContainerLike = {
    querySelector(selector: string): ElementLike | null
    getBoundingClientRect(): { left: number; top: number; width: number; height: number }
}

const CAPTION_SELECTORS = ['.mmgis-comparison-label--left', '.mmgis-comparison-label--right']

/**
 * The captions as the screen shows them, measured against the container and
 * scaled by `dpr` into output pixels. A caption with no text, or no box (a
 * side with nothing to name draws none), is left out.
 */
export function readCaptions(container: ContainerLike, dpr: number): Caption[] {
    const origin = container.getBoundingClientRect()
    const captions: Caption[] = []
    for (const selector of CAPTION_SELECTORS) {
        const el = container.querySelector(selector)
        const text = (el?.textContent ?? '').trim()
        if (!el || !text) continue
        const rect = el.getBoundingClientRect()
        if (!(rect.width > 0 && rect.height > 0)) continue
        captions.push({
            text,
            x: (rect.left - origin.left) * dpr,
            y: (rect.top - origin.top) * dpr,
            width: rect.width * dpr,
            height: rect.height * dpr,
        })
    }
    return captions
}

// Logical pixels, matching MapComparison.css; multiplied by `dpr` when drawn.
const RULE_WIDTH = 3
const DISC_RADIUS = 20
const DISC_RING = 2
const CHIP_PAD_X = 10
const CHIP_FONT = 12
const CHIP_WEIGHT = '600'

type ChromeCtx = Pick<
    CanvasRenderingContext2D,
    'fillRect' | 'strokeRect' | 'fillText' | 'beginPath' | 'arc' | 'fill' | 'stroke' | 'save' | 'restore'
> & {
    fillStyle: unknown
    strokeStyle: unknown
    lineWidth: number
    font: string
    textBaseline: CanvasTextBaseline
    textAlign: CanvasTextAlign
    shadowColor: string
    shadowBlur: number
}

/**
 * Paints the divider (rule and handle disc) at `dividerPos` and the caption
 * chips over a comparison image, in output pixels at `dpr`.
 */
export function drawComparisonChrome(
    ctx: ChromeCtx,
    opts: {
        width: number
        height: number
        dividerPos: number
        dpr: number
        captions: Caption[]
        theme?: ChromeTheme
    },
): void {
    const { width, height, dividerPos, dpr, captions, theme = DEFAULT_CHROME_THEME } = opts
    const x = Math.round(Math.max(0, Math.min(1, dividerPos)) * width)

    ctx.save()
    ctx.shadowColor = 'rgba(0, 0, 0, 0.15)'
    ctx.shadowBlur = 4 * dpr
    const rule = RULE_WIDTH * dpr
    ctx.fillStyle = theme.rule
    ctx.fillRect(x - rule / 2, 0, rule, height)

    const radius = DISC_RADIUS * dpr
    ctx.beginPath()
    ctx.arc(x, height / 2, radius, 0, Math.PI * 2)
    ctx.fillStyle = theme.disc
    ctx.fill()
    ctx.lineWidth = DISC_RING * dpr
    ctx.strokeStyle = theme.rule
    ctx.stroke()
    ctx.restore()

    ctx.font = `${CHIP_WEIGHT} ${Math.round(CHIP_FONT * dpr)}px ${theme.family}`
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    for (const caption of captions) {
        ctx.save()
        ctx.shadowColor = 'rgba(0, 0, 0, 0.15)'
        ctx.shadowBlur = 2 * dpr
        ctx.fillStyle = theme.chipBackground
        ctx.fillRect(caption.x, caption.y, caption.width, caption.height)
        ctx.restore()
        ctx.lineWidth = dpr
        ctx.strokeStyle = theme.chipBorder
        ctx.strokeRect(caption.x + 0.5 * dpr, caption.y + 0.5 * dpr, caption.width - dpr, caption.height - dpr)
        ctx.fillStyle = theme.ink
        ctx.fillText(caption.text, caption.x + CHIP_PAD_X * dpr, caption.y + caption.height / 2)
    }
}
