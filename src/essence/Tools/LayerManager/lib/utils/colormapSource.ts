// Where the ramp picker gets its ramps. The host installs a source, because
// which ramps a layer can use and what they look like is the host's to say:
// the picker lists and draws exactly what the host will paint.

export type ColormapSource = {
    /** The ramp names a layer can be offered, forward and `_r`, or null. */
    list: (layerId: string) => Promise<string[] | null>
    /** One ramp's colours for a layer, or null when none is defined. */
    colors: (layerId: string, colormap: string) => Promise<string[] | null>
}

let source: ColormapSource | null = null

/** Installs the host's ramps; null removes them. */
export const setColormapSource = (next: ColormapSource | null): void => {
    source = next
}

export const getColormapSource = (): ColormapSource | null => source
