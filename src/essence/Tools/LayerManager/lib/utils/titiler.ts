import { isStaticBuild } from '../../../../../pre/capabilities'
import ServiceUrls from '../../../../Basics/ServiceUrls/ServiceUrls'

export const getTiTilerBaseUrl = (): string | null => {
    // Static builds have no same-origin /titiler proxy; resolve the
    // configured external TiTiler (null when none is configured)
    if (isStaticBuild()) {
        return ServiceUrls.getTiTilerUrl()
    }
    const pathname = (window.location.pathname || '').replace(/\/$/, '')
    return `${window.location.origin}${pathname}/titiler`
}

export const getTiTilerUrl = (endpoint: string): string | null => {
    const baseUrl = getTiTilerBaseUrl()
    if (baseUrl == null) return null
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
    return `${baseUrl}${normalizedEndpoint}`
}
