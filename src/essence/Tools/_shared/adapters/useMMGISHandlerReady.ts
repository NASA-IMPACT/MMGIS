import { useEffect } from 'react'
import { whenMMGISHandlerReady } from './whenMMGISHandlerReady'

/**
 * Polls mmgisAPI.hasHandler(name) until it returns true, then invokes onReady once.
 *
 * Use when a mmgisAPI capability is registered asynchronously during MMGIS boot
 * (e.g. Layers_.fina() registers 'layers:getAll' etc. only after the mission's
 * layers are loaded). Without this, components that request a not-yet-registered
 * handler at mount silently get null/empty results.
 *
 * Stops after `timeoutMs` if the handler never appears (with a console warning),
 * calling `onTimeout` if one was given. A caller that holds work back until
 * `onReady` runs needs that second callback: the handler may belong to a part
 * of boot that failed, and nothing else reports it.
 *
 * Both callbacks are effect dependencies, so both must keep a stable identity
 * across renders. A fresh one each render restarts the poll, and with it the
 * deadline `timeoutMs` is measured from, so `onTimeout` would never fire.
 *
 * The waiting itself lives in {@link whenMMGISHandlerReady}, which a plugin
 * with no React component of its own can call directly.
 */
export const useMMGISHandlerReady = (
    handlerName: string,
    onReady: () => void,
    options: {
        intervalMs?: number
        timeoutMs?: number
        onTimeout?: () => void
    } = {},
): void => {
    const { intervalMs = 200, timeoutMs = 10000, onTimeout } = options
    useEffect(
        () =>
            whenMMGISHandlerReady(handlerName, onReady, {
                intervalMs,
                timeoutMs,
                onTimeout,
            }),
        [handlerName, onReady, intervalMs, timeoutMs, onTimeout],
    )
}
