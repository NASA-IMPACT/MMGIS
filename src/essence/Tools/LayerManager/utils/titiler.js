/**
 * TiTiler URL utilities
 */

/**
 * Get the base TiTiler URL for the current MMGIS instance
 * @returns {string} Base TiTiler URL
 */
export const getTiTilerBaseUrl = () => {
    const pathname = (window.location.pathname || '').replace(/\/$/, '')
    return `${window.location.origin}${pathname}/titiler`
}

/**
 * Build a full TiTiler URL for a given endpoint
 * @param {string} endpoint - The TiTiler endpoint path (e.g., '/colorMaps/viridis')
 * @returns {string} Full TiTiler URL
 */
export const getTiTilerUrl = (endpoint) => {
    const baseUrl = getTiTilerBaseUrl()
    // Ensure endpoint starts with /
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
    return `${baseUrl}${normalizedEndpoint}`
}
