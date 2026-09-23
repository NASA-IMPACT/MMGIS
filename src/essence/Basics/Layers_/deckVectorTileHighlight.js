import { hexToRgba } from '../MapEngines/Adapters/DeckGLHelpers'

/**
 * The highlight a layer gets when its mission chose no colour: black at a
 * tenth, which darkens a feature of any hue without recolouring it. deck's own
 * default is a half-opaque navy, which reads as a bruise over a warm palette
 * and vanishes into a cool one.
 */
const DEFAULT_HIGHLIGHT = [0, 0, 0, 26]

/**
 * The deck.gl props that decide whether, and how, a vector tile feature
 * highlights under the cursor, read from the layer's configured style.
 *
 * deck's MVTLayer does not use the ordinary auto-highlight: it sets
 * `autoHighlight` to false on the sub-layers it renders and highlights through
 * `uniqueIdProperty` instead, matching the hovered feature by that property's
 * value so a feature split across tiles highlights as one shape. With no such
 * property the match answers undefined and nothing highlights, whatever the
 * checkbox says — so the mission's chosen id key has to travel with it.
 *
 * Lives outside Map_ so the mapping can be read and tested on its own; Map_
 * spreads the result into the layer's native options.
 *
 * @param {object} [style] - The layer's configured `style` block.
 * @returns {{autoHighlight: boolean, uniqueIdProperty: string|undefined,
 *            highlightColor: [number, number, number, number]}}
 */
export function vectorTileHighlightOptions(style) {
    const vtId = typeof style?.vtId === 'string' ? style.vtId.trim() : ''

    return {
        autoHighlight: style?.hoverHighlight === true,
        // Undefined rather than '': deck reads an empty key as "no key", and
        // passing the empty string through would only restate its own default.
        uniqueIdProperty: vtId === '' ? undefined : vtId,
        highlightColor: highlightColor(style) ?? DEFAULT_HIGHLIGHT,
    }
}

/**
 * The configured highlight colour as deck's four channels, or null when the
 * mission configured none it could read.
 *
 * Opacity rides along in the colour: the picker writes `rgba(...)` as soon as
 * a colour is less than fully opaque, and the colour helper reads the alpha
 * back out. A fill keeps opacity in a field of its own because Leaflet styles
 * take the two apart; nothing here does.
 */
function highlightColor(style) {
    const configured = style?.hoverHighlightColor
    if (typeof configured !== 'string' || configured.trim() === '') return null

    // Read twice against opposite fallbacks. The helper answers its fallback
    // for a colour it cannot parse, and gives no other sign of having done so;
    // two readings that disagree were both fallbacks, which is the one case
    // where a mission is better served by deck's default than by a colour
    // nobody chose.
    const asBlack = hexToRgba(configured.trim(), undefined, [0, 0, 0, 255])
    const asWhite = hexToRgba(configured.trim(), undefined, [255, 255, 255, 255])
    const unreadable =
        asBlack[0] !== asWhite[0] ||
        asBlack[1] !== asWhite[1] ||
        asBlack[2] !== asWhite[2]

    return unreadable ? null : asBlack
}
