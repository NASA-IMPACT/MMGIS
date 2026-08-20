/**
 * Builds the guard every resource-targeting provider shares: reject a payload
 * whose id field is missing or not a string, then reject when the owning
 * subsystem is absent. Both refusals use the same vocabulary the subsystems
 * themselves return, so a caller sees one failure model regardless of which
 * layer refused.
 *
 * @param {string} idField - Payload key naming the target ('panelId', 'pluginId')
 * @param {function} getOwner - Resolves the owning subsystem at call time; a
 *   value captured at registration would go stale across a layout teardown
 */
export const withResource = (idField, getOwner) => (fn) => (payload) => {
    const id = (payload || {})[idField]
    if (typeof id !== 'string') return { ok: false, reason: 'bad-request' }

    const owner = getOwner()
    if (!owner) return { ok: false, reason: 'layout-inactive' }

    return fn(owner, id, payload)
}

/**
 * Wraps a state-setting handler so a state outside `allowed` is refused as
 * bad-request, ahead of any call into the subsystem.
 *
 * @param {readonly string[]} allowed - The subsystem's state vocabulary
 * @param {function} fn - Receives (owner, id, state)
 */
export const withStateIn = (allowed, fn) => (owner, id, payload) => {
    const { state } = payload
    return allowed.includes(state)
        ? fn(owner, id, state)
        : { ok: false, reason: 'bad-request' }
}
