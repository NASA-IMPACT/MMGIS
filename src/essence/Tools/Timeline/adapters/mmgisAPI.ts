// Core is reached only through the shared client's request/provide bus, so
// every call survives a sandbox boundary. Layer and tool-var handlers are
// registered in Layers_.fina(), so callers gate on readiness.

export {
    mmgisRequest,
    mmgisOn,
    mmgisEmit,
    mmgisProvide,
    mmgisHasHandler,
    mmgisGetLayerConfigs,
    mmgisGetVisibleLayers,
    mmgisIsTimeEnabled,
} from '../../_shared/adapters/mmgisAPI'

export type { LayerConfig } from '../../_shared/adapters/mmgisAPI'
