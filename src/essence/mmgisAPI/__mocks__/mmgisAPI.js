// Test stub for mmgisAPI, picked up automatically by Vitest when a spec calls
// `vi.mock('.../mmgisAPI')` without a factory.
//
// PanelManager_ imports mmgisAPI, which transitively pulls in the entire Map_
// rendering stack. The panel specs only exercise panel logic, so this stub
// stands in with a no-op event bus and keeps the import graph light.
export const mmgisAPI = { emit: () => {} }
export const mmgisAPI_ = {}
