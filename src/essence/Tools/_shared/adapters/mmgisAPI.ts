type EventCleanup = () => void

type MMGISAPI = {
    request: (name: string, params?: unknown) => Promise<unknown>
    on: (event: string, handler: (payload?: unknown) => void) => EventCleanup
    emit: (event: string, payload?: unknown) => void
    provide?: (name: string, handler: (...args: unknown[]) => unknown) => EventCleanup
    hasHandler?: (name: string) => boolean
    writeCoordinateURL?: () => string
    getMapScreenshot?: () => Promise<MapScreenshotResult>
    getViewState?: () => ViewState
}

export type MapScreenshotResult = {
    blob: Blob
    mimeType: 'image/png'
    extension: 'png'
    width: number
    height: number
}

export type ViewState = {
    missionName: string | null
    time: string | null
    center: { lat: number; lng: number } | null
    zoom: number | null
}

declare global {
    interface Window {
        mmgisAPI?: MMGISAPI
    }
}

export const mmgisRequest = async <T = unknown>(name: string, params?: unknown): Promise<T | null> => {
    if (window.mmgisAPI?.request) {
        return (await window.mmgisAPI.request(name, params)) as T
    }
    return null
}

export const mmgisOn = (event: string, handler: (payload?: unknown) => void): EventCleanup => {
    if (!window.mmgisAPI?.on) return () => {}
    return window.mmgisAPI.on(event, handler)
}

export const mmgisEmit = (event: string, payload?: unknown): void => {
    window.mmgisAPI?.emit?.(event, payload)
}

export const mmgisProvide = (name: string, handler: (...args: unknown[]) => unknown): EventCleanup => {
    if (!window.mmgisAPI?.provide) return () => {}
    return window.mmgisAPI.provide(name, handler)
}

export const mmgisHasHandler = (name: string): boolean => {
    return window.mmgisAPI?.hasHandler?.(name) === true
}

// writeCoordinateURL / getMapScreenshot are first-class methods on the public
// mmgisAPI surface (not request/provide handlers), so they're wrapped here as
// thin pass-throughs. This keeps plugins talking to core only through this
// shared client rather than reaching into core internals.

/**
 * Returns the current view as a complete, self-contained share URL (the long
 * form of "Copy Link"). Synchronous, no backend. Null if core isn't ready.
 */
export const mmgisWriteCoordinateURL = (): string | null => {
    return window.mmgisAPI?.writeCoordinateURL?.() ?? null
}

/**
 * Captures the current map as a PNG Blob plus image metadata.
 * Resolves to null if core isn't ready.
 */
export const mmgisGetMapScreenshot = async (): Promise<MapScreenshotResult | null> => {
    if (window.mmgisAPI?.getMapScreenshot) {
        return await window.mmgisAPI.getMapScreenshot()
    }
    return null
}

/**
 * Returns metadata about the current view (mission name, time, center, zoom)
 * for provenance-rich export filenames. Null if core isn't ready; individual
 * fields are null until the mission has loaded far enough to answer them.
 */
export const mmgisGetViewState = (): ViewState | null => {
    return window.mmgisAPI?.getViewState?.() ?? null
}
