import { hexToRgba } from '../MapEngines/Adapters/DeckGLHelpers'
import HighlightLineWidthExtension from '../MapEngines/Adapters/HighlightLineWidthExtension'

// Black at a tenth darkens any hue; deck's default navy clashes with warm palettes.
const DEFAULT_HIGHLIGHT = [0, 0, 0, 26]

// One unit of alpha: invisible, but keeps luma's highlight blend
// (a / (a + fillAlpha * (1 - a))) away from 0/0 on a transparent fill.
const UNTINTED_HIGHLIGHT = [0, 0, 0, 1]

const STROKE_ONLY_SUBLAYER_PROPS = {
    'polygons-fill': { highlightColor: UNTINTED_HIGHLIGHT },
}

/**
 * deck.gl props for hovering a vector tile feature, from the layer's style.
 *
 * MVTLayer matches the hovered feature by `uniqueIdProperty`, so without a
 * vtId nothing highlights. Polygons highlight only their outline when one
 * shows on hover, and otherwise tint their fill so the hover stays visible.
 * Points draw fill and stroke in one sub-layer, so they still tint whole.
 */
export function vectorTileHighlightOptions(style) {
    const vtId = typeof style?.vtId === 'string' ? style.vtId.trim() : ''
    const strokeWidth = strokeWidthOptions(style)

    return {
        autoHighlight: style?.hoverHighlight === true,
        uniqueIdProperty: vtId === '' ? undefined : vtId,
        highlightColor: highlightColor(style),
        ...(hoverStrokeVisible(style, strokeWidth.highlightLineWidth)
            ? { _subLayerProps: STROKE_ONLY_SUBLAYER_PROPS }
            : {}),
        ...strokeWidth,
    }
}

// Whether the hovered outline draws: a non-zero opacity and either a styled
// weight or a highlight width that widens a zero-weight stroke into view.
// Defaults match the stroke DeckGLHelpers resolves from the same style.
function hoverStrokeVisible(style, highlightLineWidth) {
    const opacity = style?.opacity !== undefined ? Number(style.opacity) : 1
    const weight = style?.weight !== undefined ? Number(style.weight) : 1
    return opacity > 0 && (weight > 0 || highlightLineWidth > 0)
}

function strokeWidthOptions(style) {
    const width = Number(style?.hoverHighlightWidth)
    if (!(width > 0)) return {}
    return {
        extensions: [new HighlightLineWidthExtension()],
        highlightLineWidth: width,
    }
}

// The picker writes opacity into the colour as rgba(), so it needs no field of its own.
function highlightColor(style) {
    const configured = style?.hoverHighlightColor?.trim?.()
    if (!configured) return DEFAULT_HIGHLIGHT
    return hexToRgba(configured, undefined, DEFAULT_HIGHLIGHT)
}
