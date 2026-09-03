/**
 * Hand a freshly built layer to the map engine, in the state the mission
 * configured it.
 *
 * Called for every layer at creation, not only the ones that start switched
 * on: the engine holds each layer from then until it is removed, so an
 * opacity write, a colormap pick or a time refresh while a layer is off still
 * reaches the instance that is shown next.
 *
 * Visibility is passed in rather than left for `addVisible` to correct, since
 * a builder can trigger `addVisible` itself — through `allLayersLoaded` —
 * before returning here.
 *
 * Everything addresses the engine by uuid, not by the native object: the
 * engine's registry is keyed by uuid, and a layer MMGIS built with Leaflet
 * under the deck.gl engine carries no id the engine would recognise. The
 * engine declines such a layer, and the calls after `registerLayer` then
 * address an id it does not hold and do nothing.
 *
 * @param {object|null} engine - The active map engine, or null before one exists.
 * @param {string} uuid - Layer UUID, already resolved.
 * @param {object} nativeLayer - The engine's own object for the layer.
 * @param {number} zIndex - The layer's rank in the configured stack order.
 * @param {boolean} [visible=false] - Whether the mission configures it on.
 */
export function handOffLayerToEngine(engine, uuid, nativeLayer, zIndex, visible = false) {
    if (engine == null) return
    // `false` is the load-failure sentinel, not a layer.
    if (nativeLayer == null || nativeLayer === false) return

    engine.registerLayer(uuid, nativeLayer)
    // Before ranking: registering is the moment the engine could start
    // drawing, and requesting tiles, for a layer configured off.
    engine.setLayerVisibility(uuid, visible === true)
    engine.setLayerZIndex(uuid, zIndex)
}
