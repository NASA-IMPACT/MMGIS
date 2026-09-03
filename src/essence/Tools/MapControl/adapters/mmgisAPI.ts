// Typed wrappers over window.mmgisAPI. MMGIS-coupled — stays in MMGIS.

type EventCleanup = () => void

// Must stay structurally identical to other tools' Window.mmgisAPI augmentation
// (e.g. LayerManager's) — TS merges global declarations only if they match.
type RequestOptions = { caller?: string }

type MMGISAPI = {
    request: (
        name: string,
        params?: unknown,
        options?: RequestOptions,
    ) => Promise<unknown>
    on: (event: string, handler: (payload?: unknown) => void) => EventCleanup
    emit: (event: string, payload?: unknown) => void
    provide?: (name: string, handler: (...args: unknown[]) => unknown) => EventCleanup
    hasHandler?: (name: string) => boolean
}

declare global {
    interface Window {
        mmgisAPI?: MMGISAPI
    }
}

export const mmgisRequest = async <T = unknown>(
    name: string,
    params?: unknown,
): Promise<T | null> => {
    if (window.mmgisAPI?.request) return (await window.mmgisAPI.request(name, params)) as T
    return null
}

export const mmgisOn = (
    event: string,
    handler: (payload?: unknown) => void,
): EventCleanup => {
    if (!window.mmgisAPI?.on) return () => {}
    return window.mmgisAPI.on(event, handler)
}

export const mmgisEmit = (event: string, payload?: unknown): void => {
    window.mmgisAPI?.emit?.(event, payload)
}
