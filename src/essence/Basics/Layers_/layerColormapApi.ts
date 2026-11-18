// What sits behind the runtime colormap requests (`layers:getColormapCapabilities`,
// `layers:getColormapColors`, `layers:setColormap`): one way to ask what a
// layer's colormap supports and one way to change it, for raster and vector
// layers alike.
//
// How a change is put into effect depends on how the layer paints, so each
// kind of colormap layer (see layerColormap) registers an applier for it.
// A kind with no applier reports that it cannot change its colormap, and a
// change asked of it is refused. The checks a change must pass — a ramp the
// layer's sources list, reversing only where the source publishes the reversed
// ramp — are made here, once, before any applier runs.

import {
    findColormapRamp,
    listColormaps,
    resolveColormapColors,
    type ColormapContext,
    type ColormapRamp,
} from '../Colormaps/colormapResolver'
import {
    getBaseColormapName,
    isReversedColormap,
} from '../Colormaps/colormapNaming'
import {
    colormapKindOf,
    readLayerColormap,
    type ColormapKind,
    type LayerColormap,
} from './layerColormap'

type LooseConfig = Record<string, any>

/** What a layer's colormap supports, as `layers:getColormapCapabilities` answers. */
export type ColormapCapabilities = {
    /** Whether the layer colours by a colormap at all. */
    hasColormap: boolean
    /** Whether `layers:setColormap` can change it in the running dashboard. */
    canChangeColormap: boolean
    /** The layer's colormap setting as it stands, or null without one. */
    colormap: LayerColormap | null
    /** Whether the layer's current ramp may be offered reversed. */
    reversible: boolean
    /**
     * The ramps the layer can use, each marked reversible or not; never
     * reversible for a categorical setting. Null without a colormap.
     */
    ramps: ColormapRamp[] | null
    /** The source the ramp list came from, or null without a colormap. */
    sourceId: string | null
}

/** A change to a layer's colormap. Fields left out keep their current value. */
export type ColormapChange = {
    /** The ramp. A `_r` suffix asks for it reversed, unless `reversed` says otherwise. */
    name?: string
    reversed?: boolean
    min?: number
    max?: number
}

/**
 * Puts a validated setting into effect for one layer. Resolves to whether it
 * was applied.
 */
export type ColormapApplier = (
    uuid: string,
    layerObj: LooseConfig,
    next: LayerColormap
) => Promise<boolean> | boolean

/**
 * Whether this layer, of this kind, can change its colormap where it is
 * painted now. Some layers can on one engine and not on another — a raster
 * whose tile URL carries no colormap can still change it when the client-side
 * renderer paints it — so the answer comes from the caller, which knows the
 * engine.
 */
export type CanChangeColormap = (kind: ColormapKind, layerObj: LooseConfig) => boolean

const appliers = new Map<ColormapKind, ColormapApplier>()

/**
 * Makes a kind of colormap layer changeable at runtime. Returns a function
 * that removes the applier again.
 */
export const registerColormapApplier = (
    kind: ColormapKind,
    applier: ColormapApplier
): (() => void) => {
    appliers.set(kind, applier)
    return () => {
        if (appliers.get(kind) === applier) appliers.delete(kind)
    }
}

const NO_COLORMAP: ColormapCapabilities = {
    hasColormap: false,
    canChangeColormap: false,
    colormap: null,
    reversible: false,
    ramps: null,
    sourceId: null,
}

const canChange = (
    kind: ColormapKind,
    layerObj: LooseConfig,
    canChangeHere: CanChangeColormap
): boolean => appliers.has(kind) && canChangeHere(kind, layerObj)

/** The ramps a setting can choose from, reversible only where it may be. */
const rampsFor = async (
    setting: LayerColormap,
    ctx: ColormapContext
): Promise<{ sourceId: string; ramps: ColormapRamp[] }> => {
    const listed = await listColormaps(setting.source, ctx)
    if (setting.mode !== 'categorical') return listed
    return {
        ...listed,
        ramps: listed.ramps.map((ramp) => ({ ...ramp, reversible: false })),
    }
}

/** What a layer's colormap supports right now. Never rejects. */
export const colormapCapabilitiesOf = async (
    layerObj: LooseConfig | null | undefined,
    ctx: ColormapContext,
    canChangeHere: CanChangeColormap
): Promise<ColormapCapabilities> => {
    const kind = colormapKindOf(layerObj)
    const setting = readLayerColormap(layerObj)
    if (!kind || !setting) return { ...NO_COLORMAP }
    const { sourceId, ramps } = await rampsFor(setting, ctx)
    return {
        hasColormap: true,
        canChangeColormap: canChange(kind, layerObj, canChangeHere),
        colormap: setting,
        reversible: findColormapRamp(ramps, setting.name)?.reversible === true,
        ramps,
        sourceId,
    }
}

/**
 * One ramp's colours as this layer would paint them — from its own sources,
 * in its mode — for a picker swatch that has to match the map. Null for a
 * layer with no colormap.
 */
export const colormapColorsFor = async (
    layerObj: LooseConfig | null | undefined,
    ctx: ColormapContext,
    ramp: { name?: string; reversed?: boolean }
): Promise<string[] | null> => {
    const setting = readLayerColormap(layerObj)
    if (!setting) return null
    return resolveColormapColors(
        {
            name: ramp.name || setting.name,
            reversed: ramp.name == null ? setting.reversed : ramp.reversed === true,
            mode: setting.mode,
            source: setting.source,
        },
        ctx
    )
}

const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value)

/**
 * The setting a change asks for, checked against the layer's sources, or
 * null when it cannot be applied: an unknown ramp, a reversal the source does
 * not publish, or a bound that is not a number.
 */
const nextSetting = async (
    current: LayerColormap,
    change: ColormapChange,
    ctx: ColormapContext
): Promise<LayerColormap | null> => {
    if (change.name != null && (typeof change.name !== 'string' || !change.name.trim()))
        return null
    if (change.reversed != null && typeof change.reversed !== 'boolean') return null
    if (change.min != null && !isFiniteNumber(change.min)) return null
    if (change.max != null && !isFiniteNumber(change.max)) return null

    const named = change.name != null
    const askedReversed =
        change.reversed ?? (named ? isReversedColormap(change.name) : undefined)
    const name = named ? getBaseColormapName(change.name) : current.name

    const { ramps } = await rampsFor(current, ctx)
    const ramp = findColormapRamp(ramps, name)
    if (!ramp) return null

    let reversed = askedReversed ?? current.reversed
    if (reversed && !ramp.reversible) {
        // Asked for outright, a reversal the source does not publish is
        // refused. Carried over from the previous ramp, it is dropped: the new
        // ramp simply cannot be shown reversed.
        if (askedReversed === true) return null
        reversed = false
    }

    return {
        ...current,
        name: ramp.name,
        reversed,
        min: change.min ?? current.min,
        max: change.max ?? current.max,
    }
}

/**
 * Changes a layer's ramp, direction and/or range, through the applier for its
 * kind. Resolves to false, changing nothing, when the layer has no colormap,
 * cannot change it where it is painted, or the change does not pass the
 * checks above.
 */
export const changeLayerColormap = async (
    uuid: string,
    layerObj: LooseConfig | null | undefined,
    change: ColormapChange | null | undefined,
    ctx: ColormapContext,
    canChangeHere: CanChangeColormap
): Promise<boolean> => {
    const kind = colormapKindOf(layerObj)
    const current = readLayerColormap(layerObj)
    if (!kind || !current || change == null || typeof change !== 'object')
        return false
    if (!appliers.has(kind)) {
        console.warn(
            `layers:setColormap: ${kind} layers cannot change their colormap yet ('${uuid}').`
        )
        return false
    }
    if (!canChangeHere(kind, layerObj)) return false

    const next = await nextSetting(current, change, ctx)
    if (!next) return false
    return (await appliers.get(kind)(uuid, layerObj, next)) === true
}
