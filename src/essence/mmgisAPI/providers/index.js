import { registerPanelProviders } from './panels'
import { registerPluginProviders } from './plugins'

/**
 * Register every core provider against the bus.
 *
 * Dependencies are passed as getters rather than values: the panel manager and
 * plugin controller are injected by the UI at init and cleared at destroy, so a
 * handler captured at registration time would go stale.
 */
export function registerCoreProviders(api, { getPanelManager, getPluginController }) {
    registerPanelProviders(api, getPanelManager)
    registerPluginProviders(api, getPluginController)
}
