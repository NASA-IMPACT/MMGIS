import { deckCOGProps } from '../MapEngines/Adapters/DeckCOGLayer'
import { colormapTableNow } from '../Colormaps/colormapResolver'
import { resolveDeckCOGFileUrl } from './tileLayerSource'
import { readRasterColormap } from './layerColormap'
import { colormapContextFor } from './layerTitilerUrl'
import L_ from './Layers_'

/**
 * The colormap table a client-side COG layer paints with right now, from the
 * layer's colormap sources: the same table its legend and picker swatch show.
 *
 * Never waits. A ramp only the layer's tiling service has, or the service's
 * own reversed table, is not known until the service answers; until then the
 * layer paints with the best table already known (the bundled ramp, or the
 * fallback), and repaints once the service's table arrives. A layer the
 * engine does not hold yet has its stored instance rebuilt instead, so it is
 * added with the right table.
 *
 * @param {string} uuid - Layer UUID, also the engine-side layer id.
 * @param {object} layerObj - The layer's config.
 * @returns {{key: string, table: Uint8ClampedArray}}
 */
export function deckColormapFor(uuid, layerObj) {
    return colormapTableNow(
        readRasterColormap(layerObj),
        colormapContextFor(layerObj),
        () => {
            if (L_.Map_?.engine?.refreshLayer(uuid)) return
            const stored = L_.layers.layer[uuid]
            if (stored && typeof stored.clone === 'function')
                L_.layers.layer[uuid] = makeDeckCOGRefresher(uuid, layerObj)(stored)
        }
    )
}

/**
 * How a client-side COG layer recomputes itself, for
 * `IMapEngine.setLayerRefresher`.
 *
 * Lives on the domain side, not the adapter: it reads mission config and the
 * opacity registry, which adapters must not know about. Colormap, rescale,
 * opacity and the time-substituted file URL are all re-derived per call, so
 * one path covers every kind of change — including a colormap table that
 * arrived from the layer's tiling service after it was first painted (see
 * deckColormapFor). The returned instance keeps the
 * layer's id, so deck.gl diffs it against the old one and cached tiles
 * survive.
 *
 * @param {string} uuid - Layer UUID, also the engine-side layer id.
 * @param {object} layerObj - Fallback config used when the registry has no
 *   `L_.layers.data` entry for `uuid`.
 * @returns {(layer: object) => object} A refresher returning the replacement.
 */
export function makeDeckCOGRefresher(uuid, layerObj) {
    return (layer) => {
        // Looked up per call rather than captured, so this stays a derivation
        // of current config: every writer mutates the entry in place, but a
        // captured reference would go stale if a future write replaced the
        // entry outright instead of mutating it.
        const config = L_.layers.data[uuid] ?? layerObj
        return layer.clone(
            deckCOGProps(uuid, {
                rawCogUrl: resolveDeckCOGFileUrl(config),
                layerObj: config,
                colormap: deckColormapFor(uuid, config),
                // ?? not ||: an opacity of 0 is a real value, not "default to 1"
                opacity: L_.layers.opacity[uuid] ?? 1,
            })
        )
    }
}
