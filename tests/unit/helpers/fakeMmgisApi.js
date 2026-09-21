import { vi } from 'vitest'

/**
 * A stand-in for the global bus a plugin subscribes, requests and emits
 * through. Calls are recorded; the popup impls model core's one-slot contract,
 * every show being answered on its own promise with how its card closed.
 *
 * Callers add their own request implementations through `requestImpl`, which
 * take precedence over nothing — a name with no implementation answers `true`,
 * as a provider returning nothing does.
 */
export function makeFakeMmgisApi() {
    const listeners = new Map()
    const requests = []
    const emits = []
    const provided = new Map()
    const requestImpl = new Map()

    let openPopup = null
    const settleOpen = (action) => {
        if (!openPopup) return
        const { resolve } = openPopup
        openPopup = null
        resolve({ action })
    }

    const api = {
        on(event, handler) {
            if (!listeners.has(event)) listeners.set(event, new Set())
            listeners.get(event).add(handler)
            return () => api.off(event, handler)
        },
        off(event, handler) {
            const set = listeners.get(event)
            if (set) set.delete(handler)
        },
        emit(event, data) {
            emits.push({ event, data })
            // Snapshot: a handler may unsubscribe itself while dispatching.
            Array.from(listeners.get(event) || []).forEach((h) => h(data))
        },
        // The provider runs inside the call, before the promise is handed back,
        // as core's does.
        request(name, payload) {
            requests.push({ name, payload })
            const impl = requestImpl.get(name)
            try {
                return Promise.resolve(impl ? impl(payload) : true)
            } catch (err) {
                return Promise.reject(err)
            }
        },
        // The plugin-scoped handle a tool mints in make(): emits and provides
        // are prefixed with the plugin's address. It has no `request` and no
        // `on` — those go through this bus directly.
        forPlugin(address) {
            const prefix = `plugin:${address}:`
            return {
                emit: (event, data) => api.emit(prefix + event, data),
                provide: (name, handler) => api.provide(prefix + name, handler),
                getVars: () => ({}),
            }
        },
        provide(name, handler) {
            provided.set(name, handler)
            return () => provided.delete(name)
        },

        // Test-only accessors.
        requestImpl,
        listenerCount: (event) => listeners.get(event)?.size || 0,
        namesOf: (name) => requests.filter((r) => r.name === name),
        emitsOf: (event) => emits.filter((e) => e.event === event),
        /** Call a registered provider by its fully qualified name. */
        callProvider: (name, payload) => provided.get(name)?.(payload),
        /** Close the open card the way core would, answering its request. */
        closePopup: (action) => settleOpen(action),
        hasOpenPopup: () => openPopup !== null,
        /** The payload of the card currently open, or null. */
        openPopupPayload: () => openPopup?.payload ?? null,
        reset() {
            requests.length = 0
            emits.length = 0
        },
    }

    // Showing takes the one slot; whatever was in it answers 'closed'.
    requestImpl.set('map:showPopup', (payload) => {
        settleOpen('closed')
        return new Promise((resolve) => {
            openPopup = { payload, resolve }
        })
    })
    requestImpl.set('map:hidePopup', () => {
        settleOpen('closed')
        return true
    })

    return api
}

/**
 * Let queued microtasks (bus request promises) run. A single bus round trip
 * takes more than one tick once a handler chains requests, so drain several.
 * Requires fake timers.
 */
export const flushBus = async () => {
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0)
}
