import { hexToRgba } from '../MapEngines/Adapters/DeckGLHelpers'
import HighlightWidthPathLayer from '../MapEngines/Adapters/HighlightWidthPathLayer'

// Black at a tenth darkens any hue; deck's default navy clashes with warm palettes.
const DEFAULT_HIGHLIGHT = [0, 0, 0, 26]

/**
 * deck.gl props for hovering a vector tile feature, from the layer's style.
 *
 * MVTLayer matches the hovered feature by `uniqueIdProperty`, so without a
 * vtId nothing highlights. Only strokes are highlighted: the polygon fill
 * sub-layer gets a zero-alpha highlight, which deck blends in as nothing.
 * Points draw fill and stroke in one sub-layer, so they still tint whole.
 */
export function vectorTileHighlightOptions(style) {
    const vtId = typeof style?.vtId === 'string' ? style.vtId.trim() : ''

    return {
        autoHighlight: style?.hoverHighlight === true,
        uniqueIdProperty: vtId === '' ? undefined : vtId,
        highlightColor: highlightColor(style),
        _subLayerProps: {
            'polygons-fill': { highlightColor: [0, 0, 0, 0] },
            ...strokeWidthOverrides(style),
        },
    }
}

function strokeWidthOverrides(style) {
    const width = Number(style?.hoverHighlightWidth)
    if (!(width > 0)) return {}
    const stroke = { type: HighlightWidthPathLayer, highlightLineWidth: width }
    return { 'polygons-stroke': stroke, linestrings: stroke }
}

// The picker writes opacity into the colour as rgba(), so it needs no field of its own.
function highlightColor(style) {
    const configured = style?.hoverHighlightColor?.trim?.()
    if (!configured) return DEFAULT_HIGHLIGHT
    return hexToRgba(configured, undefined, DEFAULT_HIGHLIGHT)
}
