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
// direct method calls don't). The bus name strings live here and nowhere
// else. Each wrapper resolves null when core is absent or too old to
// register the handler; errors thrown by a registered handler still
// propagate (they are real failures, not version skew).

const mmgisRequestIfProvided = async <T = unknown>(
    name: string,
    params?: unknown,
): Promise<T | null> => {
    if (!mmgisHasHandler(name)) return null
    return mmgisRequest<T>(name, params)
}

/** The current view as a complete, self-contained share URL. */
export const mmgisWriteCoordinateURL = (): Promise<string | null> => {
    return mmgisRequestIfProvided<string>('map:writeCoordinateURL')
}

/** The current map as a PNG Blob plus image metadata. */
export const mmgisGetMapScreenshot = (): Promise<
    MapScreenshotResult | null
> => {
    return mmgisRequestIfProvided<MapScreenshotResult>('map:getScreenshot')
}

/** View metadata (mission, time, center, zoom); fields null until loaded. */
export const mmgisGetViewState = (): Promise<ViewState | null> => {
    return mmgisRequestIfProvided<ViewState>('map:getViewState')
}

/**
 * Copies text to the clipboard via core's app:copyText handler; true on
 * success. Against cores that predate the handler — including ones whose
 * direct copyText method carried a legacy execCommand path this plugin no
 * longer calls — falls back to the modern browser API only, so copy
 * silently degrades to false on old-core insecure origins.
 */
export const mmgisCopyText = async (text: string): Promise<boolean> => {
    const copied = await mmgisRequestIfProvided<boolean>('app:copyText', text)
    if (copied !== null) return copied === true
    if (!navigator.clipboard?.writeText) return false
    try {
        await navigator.clipboard.writeText(text)
        return true
    } catch {
        return false
    }
}
