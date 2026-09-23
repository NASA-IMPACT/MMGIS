/**
 * The deck.gl props that decide whether a vector tile feature highlights under
 * the cursor, read from the layer's configured style.
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
 * @returns {{autoHighlight: boolean, uniqueIdProperty: string|undefined}}
 */
export function vectorTileHighlightOptions(style) {
    const vtId = typeof style?.vtId === 'string' ? style.vtId.trim() : ''
    return {
        autoHighlight: style?.hoverHighlight === true,
        // Undefined rather than '': deck reads an empty key as "no key", and
        // passing the empty string through would only restate its own default.
        uniqueIdProperty: vtId === '' ? undefined : vtId,
    }
}
