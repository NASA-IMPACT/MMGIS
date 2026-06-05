import { useEffect } from 'react'
import { mmgisHasHandler } from './mmgisAPI'

/**
 * Polls mmgisAPI.hasHandler(name) until it returns true, then invokes onReady once.
 *
 * Use when a mmgisAPI capability is registered asynchronously during MMGIS boot
 * (e.g. Layers_.fina() registers 'layers:getAll' etc. only after the mission's
 * layers are loaded). Without this, components that request a not-yet-registered
 * handler at mount silently get null/empty results.
 *
 * Stops after `timeoutMs` if the handler never appears (with a console warning).
 */
export const useMMGISHandlerReady = (
    handlerName: string,
    onReady: () => void,
    options: { intervalMs?: number; timeoutMs?: number } = {},
): void => {
    const { intervalMs = 200, timeoutMs = 10000 } = options
    useEffect(() => {
        if (mmgisHasHandler(handlerName)) {
            onReady()
            return
        }
        const start = Date.now()
        const id = window.setInterval(() => {
            if (mmgisHasHandler(handlerName)) {
                window.clearInterval(id)
                onReady()
            } else if (Date.now() - start > timeoutMs) {
                window.clearInterval(id)
                console.warn(
                    `[useMMGISHandlerReady] '${handlerName}' not registered after ${timeoutMs}ms`,
                )
            }
        }, intervalMs)
        return () => window.clearInterval(id)
    }, [handlerName, onReady, intervalMs, timeoutMs])
}
