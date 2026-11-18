// The 256-colour lookup table the GPU raster renderer paints a colormap with.
//
// The renderer rescales each pixel to 0-255 and reads that index off the
// table, as the tiling service does with the same ramp, so a client-side
// layer and a service-rendered one look alike. Tables come from the bundled
// standard ramps in the shared 256-colour RGBA format; `_r` names paint the
// forward ramp mirrored. A name the bundle does not hold paints as the
// fallback ramp.
import { getStandardColormapTableOrFallback } from '../../Colormaps/standardColormaps'

export function buildColormapLUT(colormapName: string): Uint8ClampedArray {
    // A copy: the bundled table is shared, and the caller hands this one to
    // the GPU.
    return getStandardColormapTableOrFallback((colormapName || '').trim()).slice()
}
