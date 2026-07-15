type EventCleanup = () => void

type MMGISAPI = {
    request: (name: string, params?: unknown) => Promise<unknown>
    on: (event: string, handler: (payload?: unknown) => void) => EventCleanup
    emit: (event: string, payload?: unknown) => void
    provide?: (name: string, handler: (...args: unknown[]) => unknown) => EventCleanup
    hasHandler?: (name: string) => boolean
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

// Typed wrappers for the core capabilities this plugin consumes, so plugins
// reach core only through this shared client — and only via the
// request/provide bus (string-named messages survive a sandbox boundary;
// direct method calls don't). Each returns null if core isn't ready. The
// bus name strings live here and nowhere else.

/** The current view as a complete, self-contained share URL. */
export const mmgisWriteCoordinateURL = (): Promise<string | null> => {
    return mmgisRequest<string | null>('map:writeCoordinateURL')
}

/** The current map as a PNG Blob plus image metadata. */
export const mmgisGetMapScreenshot = (): Promise<MapScreenshotResult | null> => {
    return mmgisRequest<MapScreenshotResult>('map:getScreenshot')
}

/** View metadata (mission, time, center, zoom); fields null until loaded. */
export const mmgisGetViewState = (): Promise<ViewState | null> => {
    return mmgisRequest<ViewState>('map:getViewState')
}

/**
 * Copies text to the clipboard via core's single implementation; true on
 * success. For cores that predate the app:copyText handler, falls back to
 * the modern browser API only (no legacy path — silently degraded on
 * old-core insecure origins). The hasHandler guard matters: request()
 * throws on an unregistered name, unlike the optional chaining it replaced.
 */
export const mmgisCopyText = async (text: string): Promise<boolean> => {
    if (mmgisHasHandler('app:copyText')) {
        const copied = await mmgisRequest<boolean>('app:copyText', text)
        return copied === true
    }
    if (!navigator.clipboard?.writeText) return false
    try {
        await navigator.clipboard.writeText(text)
        return true
    } catch {
        return false
    }
}
