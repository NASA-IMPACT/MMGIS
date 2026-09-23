import { hexToRgba } from '../MapEngines/Adapters/DeckGLHelpers'

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
 *            highlightColor?: [number, number, number, number]}}
 */
export function vectorTileHighlightOptions(style) {
    const vtId = typeof style?.vtId === 'string' ? style.vtId.trim() : ''

    const options = {
        autoHighlight: style?.hoverHighlight === true,
        // Undefined rather than '': deck reads an empty key as "no key", and
        // passing the empty string through would only restate its own default.
        uniqueIdProperty: vtId === '' ? undefined : vtId,
    }

    // Omitted rather than undefined when unset: deck fills a missing prop from
    // its own defaults, but an explicit undefined overrides one.
    const color = highlightColor(style)
    if (color) options.highlightColor = color

    return options
}

/**
 * The highlight colour as deck's four channels, or nothing when the mission
 * configured none — in which case deck's own default stands.
 *
 * Opacity is a setting of its own, as it is for a fill: a colour picker gives
 * a solid colour, and a highlight usually wants to sit over the feature rather
 * than replace it.
 */
function highlightColor(style) {
    const configured = style?.hoverHighlightColor
    if (typeof configured !== 'string' || configured.trim() === '') return null

    const opacity = style?.hoverHighlightOpacity
    const alpha =
        typeof opacity === 'number' && Number.isFinite(opacity)
            ? opacity
            : undefined

    // Read twice against opposite fallbacks. The helper answers its fallback
    // for a colour it cannot parse, and gives no other sign of having done so;
    // two readings that disagree were both fallbacks, which is the one case
    // where a mission is better served by deck's default than by a colour
    // nobody chose.
    const asBlack = hexToRgba(configured.trim(), alpha, [0, 0, 0, 255])
    const asWhite = hexToRgba(configured.trim(), alpha, [255, 255, 255, 255])
    const unreadable =
        asBlack[0] !== asWhite[0] ||
        asBlack[1] !== asWhite[1] ||
        asBlack[2] !== asWhite[2]

    return unreadable ? null : asBlack
}
