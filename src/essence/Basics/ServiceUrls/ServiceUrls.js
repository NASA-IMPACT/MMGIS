/**
 * ServiceUrls - Centralized utility for getting service URLs
 *
 * Supports both local proxied services and external endpoints.
 * External URLs can be configured per-layer or globally via mmgisglobal.options.
 *
 * Services supported:
 * - titiler: COG tile serving
 * - titilerpgstac: STAC mosaic tiles
 * - stac: STAC FastAPI
 * - tipg: OGC Features/Tiles API
 * - veloserver: Wind/velocity data
 */

/**
 * Service configuration registry
 * Maps service names to their config key names and local proxy paths
 */
const SERVICE_CONFIG = {
    titiler: { configKey: 'titilerUrl', localPath: '/titiler' },
    titilerpgstac: { configKey: 'titilerPgStacUrl', localPath: '/titilerpgstac' },
    stac: { configKey: 'stacUrl', localPath: '/stac' },
    tipg: { configKey: 'tipgUrl', localPath: '/tipg' },
    veloserver: { configKey: 'veloserverUrl', localPath: '/veloserver' },
}

/**
 * Get the local proxy base URL for MMGIS
 * @returns {string} Base URL like "http://localhost:8888/mmgis"
 */
const getLocalBaseUrl = () => {
    const pathname = (window.location.pathname || '').replace(/\/$/, '')
    return `${window.location.origin}${pathname}`
}

/**
 * Whether this bundle was built without a backend (mmgisglobal.SERVER !== 'node').
 * Static builds have no same-origin service proxies to fall back to.
 * @returns {boolean}
 */
import { isStaticBuild } from '../../../pre/capabilities'

/**
 * Factory function to get a service URL
 * Priority: layerConfig > mmgisglobal.options.services > local proxy
 * Static builds have no local proxy; an explicitly configured URL is required
 * and missing config returns null (with a warning) rather than a same-origin
 * path that would silently 404.
 *
 * @param {string} serviceName - Name of the service (titiler, stac, etc.)
 * @param {object} [layerConfig] - Layer configuration (optional, for per-layer override)
 * @returns {string|null} Service base URL (null if unresolvable in a static build)
 */
const getServiceUrl = (serviceName, layerConfig = null) => {
    const config = SERVICE_CONFIG[serviceName]
    if (!config) {
        console.warn(`ServiceUrls: Unknown service "${serviceName}"`)
        return isStaticBuild() ? null : getLocalBaseUrl()
    }

    const { configKey, localPath } = config

    // Per-layer override
    if (layerConfig?.[configKey]) {
        return layerConfig[configKey].replace(/\/$/, '')
    }

    // Global override via mmgisglobal.options.services
    if (window.mmgisglobal?.options?.services?.[configKey]) {
        return window.mmgisglobal.options.services[configKey].replace(/\/$/, '')
    }

    if (isStaticBuild()) {
        console.warn(
            `ServiceUrls: No "${configKey}" configured for service "${serviceName}". Static builds require an external service URL (per-layer or via options.services).`
        )
        return null
    }

    // Default local proxy
    return `${getLocalBaseUrl()}${localPath}`
}

/**
 * Create a service URL getter for a specific service
 * @param {string} serviceName - Name of the service
 * @returns {function} Function that takes optional layerConfig and returns URL
 */
const createServiceGetter = (serviceName) => {
    return (layerConfig = null) => getServiceUrl(serviceName, layerConfig)
}

// Pre-built getters for each service
const getTiTilerUrl = createServiceGetter('titiler')
const getTiTilerPgStacUrl = createServiceGetter('titilerpgstac')
const getStacUrl = createServiceGetter('stac')
const getTipgUrl = createServiceGetter('tipg')
const getVeloserverUrl = createServiceGetter('veloserver')

/**
 * Build a TiTiler COG tiles URL
 * @param {string} cogUrl - URL to the COG file
 * @param {object} [layerConfig] - Layer configuration
 * @param {object} [options] - Additional options (tileMatrixSet, bands, resampling)
 * @returns {string} Full TiTiler tiles URL with {z}/{x}/{y} placeholders
 */
const buildTiTilerCogTilesUrl = (cogUrl, layerConfig = null, options = {}) => {
    const baseUrl = getTiTilerUrl(layerConfig)
    const tileMatrixSet = options.tileMatrixSet || layerConfig?.tileMatrixSet || 'WebMercatorQuad'

    let url = `${baseUrl}/cog/tiles/${tileMatrixSet}/{z}/{x}/{y}.webp?url=${encodeURIComponent(cogUrl)}`

    if (options.bands) {
        options.bands.forEach(band => {
            if (band != null) url += `&bidx=${band}`
        })
    }

    if (options.resampling) {
        url += `&resampling=${options.resampling}`
    }

    return url
}

/**
 * Build a TiTiler-pgSTAC collection tiles URL
 * @param {string} collectionName - STAC collection name
 * @param {object} [layerConfig] - Layer configuration
 * @param {object} [options] - Additional options (tileMatrixSet, assets, bands, resampling)
 * @returns {string} Full TiTiler-pgSTAC tiles URL with {z}/{x}/{y} placeholders
 */
const buildStacCollectionTilesUrl = (collectionName, layerConfig = null, options = {}) => {
    const baseUrl = getTiTilerPgStacUrl(layerConfig)
    const tileMatrixSet = options.tileMatrixSet || layerConfig?.tileMatrixSet || 'WebMercatorQuad'
    const assets = options.assets || 'asset'

    let url = `${baseUrl}/collections/${collectionName}/tiles/${tileMatrixSet}/{z}/{x}/{y}?assets=${assets}`

    if (options.bands) {
        options.bands.forEach(band => {
            if (band != null) url += `&asset_bidx=${assets}|${band}`
        })
    }

    if (options.resampling) {
        url += `&resampling=${options.resampling}`
    }

    return url
}

/**
 * Build a TiTiler COG point query URL
 * @param {number} lng - Longitude
 * @param {number} lat - Latitude
 * @param {string} cogUrl - URL to the COG file
 * @param {object} [layerConfig] - Layer configuration
 * @param {object} [params] - Additional query parameters (datetime, expression, bidx, etc.)
 *                           Note: expression should be pre-encoded by caller
 * @returns {string} Full TiTiler point query URL
 */
const buildTiTilerPointUrl = (lng, lat, cogUrl, layerConfig = null, params = {}) => {
    const baseUrl = getTiTilerUrl(layerConfig)
    let url = `${baseUrl}/cog/point/${lng},${lat}?assets=asset&url=${encodeURIComponent(cogUrl)}`

    Object.entries(params).forEach(([key, value]) => {
        if (value != null && value !== '') {
            if (Array.isArray(value)) {
                value.forEach(v => {
                    if (v != null) url += `&${key}=${v}`
                })
            } else {
                url += `&${key}=${value}`
            }
        }
    })

    return url
}

/**
 * Build a TiTiler-pgSTAC collection point query URL
 * @param {number} lng - Longitude
 * @param {number} lat - Latitude
 * @param {string} collectionName - STAC collection name
 * @param {object} [layerConfig] - Layer configuration
 * @param {object} [params] - Additional query parameters (datetime, expression, bidx, items_limit, etc.)
 *                           Note: expression should be pre-encoded by caller
 * @returns {string} Full TiTiler-pgSTAC point query URL
 */
const buildStacCollectionPointUrl = (lng, lat, collectionName, layerConfig = null, params = {}) => {
    const baseUrl = getTiTilerPgStacUrl(layerConfig)
    let url = `${baseUrl}/collections/${collectionName}/point/${lng},${lat}?assets=asset`

    Object.entries(params).forEach(([key, value]) => {
        if (value != null && value !== '') {
            if (Array.isArray(value)) {
                value.forEach(v => {
                    if (v != null) url += `&${key}=${v}`
                })
            } else {
                url += `&${key}=${value}`
            }
        }
    })

    return url
}

/**
 * Build a TiTiler colormap image URL
 * @param {string} colormapName - Name of the colormap
 * @param {object} [layerConfig] - Layer configuration
 * @param {string} [format] - Image format (default: 'png')
 * @returns {string|null} Colormap image URL or null if colormapName is not provided
 */
const buildColormapImageUrl = (colormapName, layerConfig = null, format = 'png') => {
    if (!colormapName) return null
    const baseUrl = getTiTilerUrl(layerConfig)
    return `${baseUrl}/colorMaps/${colormapName}?format=${format}`
}

/**
 * Build a tipg (OGC Features/Tiles) URL
 * @param {string} [endpoint] - Endpoint path appended to the tipg base URL
 * @param {object} [layerConfig] - Layer configuration
 * @returns {string|null} Full tipg URL (null if unresolvable in a static build)
 */
const buildTipgUrl = (endpoint = '', layerConfig = null) => {
    const baseUrl = getTipgUrl(layerConfig)
    if (baseUrl == null) return null
    if (!endpoint) return baseUrl
    return `${baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`
}

/**
 * Build a veloserver (wind/velocity data) URL
 * @param {string} [endpoint] - Endpoint path appended to the veloserver base URL
 * @param {object} [layerConfig] - Layer configuration
 * @returns {string|null} Full veloserver URL (null if unresolvable in a static build)
 */
const buildVeloserverUrl = (endpoint = '', layerConfig = null) => {
    const baseUrl = getVeloserverUrl(layerConfig)
    if (baseUrl == null) return null
    if (!endpoint) return baseUrl
    return `${baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`
}

/**
 * Build a STAC collection items URL
 */
const buildStacItemsUrl = (collectionName, layerConfig = null, params = {}) => {
    const baseUrl = getStacUrl(layerConfig)
    let url = `${baseUrl}/collections/${collectionName}/items`

    const queryParams = new URLSearchParams()
    Object.entries(params).forEach(([key, value]) => {
        if (value != null) queryParams.append(key, value)
    })

    const queryString = queryParams.toString()
    if (queryString) url += `?${queryString}`

    return url
}

const ServiceUrls = {
    // Core
    getLocalBaseUrl,
    getServiceUrl,
    createServiceGetter,

    // Service-specific getters
    getTiTilerUrl,
    getTiTilerPgStacUrl,
    getStacUrl,
    getTipgUrl,
    getVeloserverUrl,

    // URL builders
    buildTiTilerCogTilesUrl,
    buildStacCollectionTilesUrl,
    buildTiTilerPointUrl,
    buildStacCollectionPointUrl,
    buildColormapImageUrl,
    buildTipgUrl,
    buildVeloserverUrl,
    buildStacItemsUrl,
}

export default ServiceUrls
