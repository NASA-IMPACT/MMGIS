export const getTiTilerBaseUrl = (): string => {
    const pathname = (window.location.pathname || '').replace(/\/$/, '')
    return `${window.location.origin}${pathname}/titiler`
}

export const getTiTilerUrl = (endpoint: string): string => {
    const baseUrl = getTiTilerBaseUrl()
    const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
    return `${baseUrl}${normalizedEndpoint}`
}
