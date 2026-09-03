/**
 * Hand a freshly built layer to the map engine.
 *
 * Called once per layer at creation, for every layer the mission configures —
 * not only the ones that start switched on. The engine holds each layer from
 * that moment, ranked, and showing exactly what `visible` says.
 *
 * The visibility is stated here rather than left to `addVisible` to correct
 * afterwards, because `addVisible` cannot be relied on to run after this. A
 * builder flips its layer's loaded flag and calls `allLayersLoaded` itself,
 * and for the last layer to finish that runs `addVisible` synchronously —
 * before the builder has returned to the hand-off. That layer was asked to be
 * shown while the engine did not yet hold it, so nothing happened, and the
 * hand-off then filed it hidden: it never drew and never requested a tile.
 * Saying the state here makes the order stop mattering.
 *
 * Handing every layer over up front is what lets the engine be told about a
 * layer that is switched off. An opacity write, a colormap pick or a time
 * refresh all address the engine by uuid and land on the held instance, so
 * the layer that appears at the next switch-on already matches the panel and
 * nothing has to be replayed.
 *
 * Addressed by uuid rather than by the native object throughout: the engine's
 * registry is keyed by it, and a native object may carry no id the engine
 * recognises — under the deck.gl engine MMGIS still builds `data`, `image`,
 * `video` and `velocity` layers with Leaflet, and those carry none. Such a
 * layer is declined by `registerLayer`; the two calls after it then address
 * an id the engine does not hold and do nothing, which is the intent.
 *
 * @param {object|null} engine - The active map engine, or null before one exists.
 * @param {string} uuid - Layer UUID, already resolved.
 * @param {object} nativeLayer - The engine's own object for the layer. `null`,
 *   `undefined` or the `false` load-failure sentinel mean it was never built.
 * @param {number} zIndex - The layer's rank in the configured stack order.
 * @param {boolean} [visible=false] - Whether the mission configures this
 *   layer on. Defaults to hidden: a caller that does not know had better not
 *   guess a layer onto the screen.
 */
export function handOffLayerToEngine(engine, uuid, nativeLayer, zIndex, visible = false) {
    if (engine == null) return
    // `false` is the load-failure sentinel, not a layer.
    if (nativeLayer == null || nativeLayer === false) return

    engine.registerLayer(uuid, nativeLayer)
    // Settled immediately, before anything else: registering is the moment
    // the engine could start drawing — and, for a tile layer, requesting
    // tiles — for a layer the mission may have configured off.
    engine.setLayerVisibility(uuid, visible === true)
    // Ranked here rather than on every toggle: the rank follows the
    // configured stack order, which a checkbox does not change.
    engine.setLayerZIndex(uuid, zIndex)
}
