import {
    bundledColormapNames,
    isBundledColormap,
    resolveColormapColors,
} from '../../Basics/Colormaps/resolveColormapColors'

/**
 * The colormap ramps this build bundles, for a ramp picker with no tiling
 * service to list them. Names come forward and `_r`-reversed, the shape a
 * service's list takes; colours are the ones the map paints with.
 */
export function registerColormapProviders(api) {
    api.provide('colormaps:getBundledNames', () =>
        bundledColormapNames().flatMap((name) => [name, `${name}_r`])
    )

    // Null for a name the bundle does not hold, rather than the fallback ramp
    // resolveColormapColors would paint it with.
    api.provide('colormaps:getBundledColors', (name) =>
        typeof name === 'string' && isBundledColormap(name)
            ? resolveColormapColors(name, null)
            : null
    )
}
