import { withResource } from './_shared'

/**
 * Plugin lifecycle on the request/provide bus. Mirrors providers/panels.js:
 * registered once at module load, absent controller reported as a result, and
 * shape checks on every payload.
 */
export function registerPluginProviders(api, getController) {
    const withPlugin = withResource('pluginId', getController)

    api.provide('plugins:getAll', () => getController()?.listPlugins() ?? [])

    api.provide('plugins:setState', withPlugin((controller, pluginId, { state }) =>
        typeof state === 'string'
            ? controller.setPluginState(pluginId, state)
            : { ok: false, reason: 'bad-request' }
    ))

    api.provide('plugins:show', withPlugin((controller, pluginId) =>
        controller.setPluginState(pluginId, 'visible')
    ))

    api.provide('plugins:hide', withPlugin((controller, pluginId) =>
        controller.setPluginState(pluginId, 'hidden')
    ))
}
