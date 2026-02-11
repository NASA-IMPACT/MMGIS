import { MarkerOptions } from './types/layers'

/**
 * Optional marker support.
 *
 * Leaflet has native marker objects (L.Marker) so its adapter
 * implements this interface.
 *
 * deck.gl has no marker concept. It uses IconLayer or ScatterplotLayer
 * instead. The deck.gl adapter skips this interface and the calling
 * code would use createLayer with an icon layer config.
 *
 * This is intentionally separate from IMapEngine so that code
 * depending on markers can check for support at runtime:
 *
 *   if ('addMarker' in engine) { engine.addMarker(...) }
 */
export interface IMapEngineMarkers<TMarker = unknown> {
    /**
     * Add a marker to the map.
     */
    addMarker(options: MarkerOptions): TMarker

    /**
     * Remove a marker from the map by marker object or string id.
     */
    removeMarker(marker: TMarker | string): void

    /**
     * Update an existing marker's position, icon, or other properties.
     */
    updateMarker(marker: TMarker | string, options: Partial<MarkerOptions>): TMarker
}
