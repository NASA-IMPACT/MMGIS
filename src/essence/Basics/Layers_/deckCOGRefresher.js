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
 * @param {object} layerObj - Fallback config, used only when the registry has
 *   no `L_.layers.data` entry for `uuid` at call time.
 * @returns {(layer: object) => object} A refresher returning the replacement.
 */
export function makeDeckCOGRefresher(uuid, layerObj) {
    return (layer) => {
        // Looked up per call rather than captured, so this stays a derivation
        // of current config. Every writer mutates the entry in place today,
        // which would hide a captured reference right up until one replaces
        // the entry instead.
        const config = L_.layers.data[uuid] ?? layerObj
        return layer.clone(
            deckCOGProps(uuid, {
                rawCogUrl: resolveDeckCOGFileUrl(config),
                layerObj: config,
                // ?? not ||: an opacity of 0 is a real value, not "default to 1"
                opacity: L_.layers.opacity[uuid] ?? 1,
            })
        )
    }
}
