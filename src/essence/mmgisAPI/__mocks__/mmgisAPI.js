// Test stub for mmgisAPI, picked up automatically by Vitest when a spec calls
// `vi.mock('.../mmgisAPI')` without a factory.
//
// PanelManager_ imports mmgisAPI, which transitively pulls in the entire Map_
// rendering stack. The panel specs only exercise panel logic, so this stub
// stands in with a real mitt event bus (matching the production API, which
// also backs emit/on with mitt) and keeps the import graph light. Using a real
// bus lets the panel specs subscribe with mmgisAPI.on(...) and observe the
// layout-changed notifications the manager emits.
import mitt from 'mitt'

const events = mitt()

export const mmgisAPI = {
    emit: events.emit,
    on: events.on,
    off: events.off,
}
export const mmgisAPI_ = {}
