type EventCleanup = () => void

type MMGISAPI = {
    request: (name: string, params?: unknown) => Promise<unknown>
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
