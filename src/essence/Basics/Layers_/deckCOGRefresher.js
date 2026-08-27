import { deckCOGProps } from '../MapEngines/Adapters/DeckCOGLayer'
import { resolveDeckCOGFileUrl } from './tileLayerSource'
import L_ from './Layers_'

/**
 * How a client-side COG layer recomputes itself, for
 * `IMapEngine.setLayerRefresher`.
 *
 * Lives on the domain side, not in the adapter: it reads mission config and
 * the opacity registry, which adapters must not know about. The engine only
 * knows it has a function to call.
 *
 * Everything is re-derived per call — colormap, rescale, opacity and the
 * time-substituted file URL — so a colormap change, a rescale change and a
 * time change all flow through this one path. The returned instance keeps the
 * layer's id, so deck.gl diffs it against the old one and cached tiles survive.
 *
 * @param {string} uuid - Layer UUID, also the engine-side layer id.
 * @param {object} layerObj - The live `L_.layers.data` entry, read on each call.
 * @returns {(layer: object) => object} A refresher returning the replacement.
 */
export function makeDeckCOGRefresher(uuid, layerObj) {
    return (layer) =>
        layer.clone(
            deckCOGProps(uuid, {
                rawCogUrl: resolveDeckCOGFileUrl(layerObj),
                layerObj,
                // ?? not ||: an opacity of 0 is a real value, not "default to 1"
                opacity: L_.layers.opacity[uuid] ?? 1,
            })
        )
}
