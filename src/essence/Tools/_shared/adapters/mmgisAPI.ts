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

// Thin pass-throughs for first-class mmgisAPI methods, so plugins reach core
// only through this shared client. Each returns null if core isn't ready.

/** The current view as a complete, self-contained share URL. Synchronous. */
export const mmgisWriteCoordinateURL = (): string | null => {
    return window.mmgisAPI?.writeCoordinateURL?.() ?? null
}

/** The current map as a PNG Blob plus image metadata. */
export const mmgisGetMapScreenshot = async (): Promise<MapScreenshotResult | null> => {
    if (window.mmgisAPI?.getMapScreenshot) {
        return await window.mmgisAPI.getMapScreenshot()
    }
    return null
}

/** View metadata (mission, time, center, zoom); fields null until loaded. */
export const mmgisGetViewState = (): ViewState | null => {
    return window.mmgisAPI?.getViewState?.() ?? null
}
