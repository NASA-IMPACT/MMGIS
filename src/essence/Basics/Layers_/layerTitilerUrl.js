import ServiceUrls from '../ServiceUrls/ServiceUrls'

/**
 * Where a layer's TiTiler lives, or null when it is out of reach. A configured
 * service is someone else's to serve and always reachable; everything else
 * falls through to the same-origin `/titiler` proxy, which exists only under
 * WITH_TITILER. Without it that path reaches the SPA catch-all, which answers
 * 200 with HTML rather than failing outright.
 *
 * @param {object} layerConfig - An entry of `L_.layers.data`.
 * @returns {string|null} Base URL of the layer's TiTiler.
 */
export function titilerUrlFor(layerConfig) {
    const url = ServiceUrls.getTiTilerUrl(layerConfig)
    if (url == null) return null
    if (ServiceUrls.hasExternalServiceUrl('titiler', layerConfig)) return url
    return window.mmgisglobal?.WITH_TITILER === 'true' ? url : null
}

/**
 * What a layer's colormap sources may read about it (see colormapResolver):
 * the tiling service its ramps come from by default.
 *
 * @param {object} layerConfig - An entry of `L_.layers.data`.
 * @returns {{serviceUrl: string|null}}
 */
export function colormapContextFor(layerConfig) {
    return { serviceUrl: layerConfig ? titilerUrlFor(layerConfig) : null }
}
