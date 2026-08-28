import { withResource, withStateIn } from './_shared'

/** The lifecycle states a plugin can be commanded into. */
const PLUGIN_STATES = ['unloaded', 'hidden', 'visible']

/**
 * Plugin lifecycle on the request/provide bus. Mirrors providers/panels.js:
 * registered once at module load, absent controller reported as a result, and
 * shape checks on every payload.
 */
export function registerPluginProviders(api, getController) {
    const withPlugin = withResource('pluginId', getController)

    api.provide('plugins:getAll', () => getController()?.listPlugins() ?? [])

    api.provide('plugins:setState', withPlugin(withStateIn(PLUGIN_STATES,
        (controller, pluginId, state) => controller.setPluginState(pluginId, state)
    )))

    api.provide('plugins:show', withPlugin((controller, pluginId) =>
        controller.setPluginState(pluginId, 'visible')
    ))

    api.provide('plugins:hide', withPlugin((controller, pluginId) =>
        controller.setPluginState(pluginId, 'hidden')
    ))
}
