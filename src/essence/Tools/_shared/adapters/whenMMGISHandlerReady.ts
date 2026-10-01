import { mmgisHasHandler } from './mmgisAPI'

export interface HandlerReadyOptions {
    intervalMs?: number
    timeoutMs?: number
    /** Called once when `timeoutMs` passes without the handler appearing. */
    onTimeout?: () => void
}

/**
 * Calls `onReady` once `mmgisAPI` can answer `handlerName`, and returns a
 * canceller the caller runs on teardown.
 *
 * Several core capabilities are registered partway through MMGIS boot rather
 * than at load: `Layers_.fina()` registers `layers:getAll`, `layers:getConfig`
 * and the rest only after the mission's layers have finished loading, and it
 * is also where `L_.Map_` — and so the engine behind `map:getEngineType` — is
 * set. A plugin that asks at make() time gets a rejection, because
 * `mmgisAPI.request` throws for a name nothing has registered.
 *
 * Runs `onReady` synchronously when the handler is already there, so a caller
 * that loads late is not made to wait a poll interval.
 *
 * Gives up after `timeoutMs` with a warning: a handler that never arrives
 * means the capability is absent, not late, and a poll running for the life of
 * the page would hide that. `onTimeout` lets a caller that holds work back
 * until `onReady` act on that instead.
 */
export const whenMMGISHandlerReady = (
    handlerName: string,
    onReady: () => void,
    options: HandlerReadyOptions = {}
): (() => void) => {
    const { intervalMs = 200, timeoutMs = 10000, onTimeout } = options

    if (mmgisHasHandler(handlerName)) {
        onReady()
        return () => {}
    }

    const start = Date.now()
    const id = window.setInterval(() => {
        if (mmgisHasHandler(handlerName)) {
            window.clearInterval(id)
            onReady()
        } else if (Date.now() - start > timeoutMs) {
            window.clearInterval(id)
            console.warn(
                `[whenMMGISHandlerReady] '${handlerName}' not registered after ${timeoutMs}ms`
            )
            onTimeout?.()
        }
    }, intervalMs)

    return () => window.clearInterval(id)
}
