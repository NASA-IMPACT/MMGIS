// The bundled lookup table the GPU raster renderer paints a colormap with when
// it is handed no resolved table.
//
// The renderer rescales each pixel to 0-255 and reads that index off the
// table, as the tiling service does with the same ramp, so a client-side
// layer and a service-rendered one look alike. A layer's table normally comes
// from its colormap sources (see Layers_/deckCOGRefresher); this one comes
// from the bundled standard ramps alone: `_r` names paint the forward ramp
// mirrored, and a name the bundle does not hold paints as the fallback ramp.
import { getStandardColormapTableOrFallback } from '../../Colormaps/standardColormaps'

export function buildColormapLUT(colormapName: string): Uint8ClampedArray {
    // A copy: the bundled table is shared, and the caller hands this one to
    // the GPU.
    return getStandardColormapTableOrFallback((colormapName || '').trim()).slice()
}
