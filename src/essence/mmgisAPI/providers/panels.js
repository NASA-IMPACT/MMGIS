import { PANEL_STATE, PANEL_STATES } from '../../Basics/PanelManager_/types/layout'
import { withResource, withStateIn } from './_shared'

/**
 * Panel layout on the request/provide bus.
 *
 * Handlers register once at module load and stay registered. An absent layout
 * is reported as a `layout-inactive` result rather than a missing handler, so a
 * caller sees one consistent failure vocabulary regardless of which layout the
 * mission runs.
 *
 * Payloads arrive from arbitrary plugins, so each handler shape-checks its
 * input. Deep validation belongs in the sandbox bridge, not here.
 */
export function registerPanelProviders(api, getManager) {
    const withPanel = withResource('panelId', getManager)

    api.provide('panels:getAll', () => getManager()?.list() ?? [])

    api.provide('panels:setState', withPanel(withStateIn(PANEL_STATES,
        (manager, panelId, state) => manager.setPanelState(panelId, state)
    )))

    api.provide('panels:show', withPanel((manager, panelId) => manager.showPanel(panelId)))

    api.provide('panels:hide', withPanel((manager, panelId) =>
        manager.setPanelState(panelId, PANEL_STATE.COLLAPSED)
    ))
}
