import { PANEL_STATE } from '../../Basics/PanelManager_/types/layout'
import { withResource } from './_shared'

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

    api.provide('panels:setState', withPanel((manager, panelId, { state }) =>
        typeof state === 'string'
            ? manager.setPanelState(panelId, state)
            : { ok: false, reason: 'bad-request' }
    ))

    api.provide('panels:show', withPanel((manager, panelId) => manager.showPanel(panelId)))

    api.provide('panels:hide', withPanel((manager, panelId) =>
        manager.setPanelState(panelId, PANEL_STATE.COLLAPSED)
    ))
}
