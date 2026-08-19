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
