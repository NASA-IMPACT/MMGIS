import type { MMGISAPI } from '../../_shared/adapters/mmgisAPI'

export {
    mmgisRequest,
    mmgisOn,
    mmgisEmit,
    mmgisProvide,
    mmgisHasHandler,
} from '../../_shared/adapters/mmgisAPI'

// window.mmgisAPI is typed once, by the shared client. Config reads below go
// through direct methods core exposes outside the request/provide bus, so they
// are described by a Timeline-local widening of that type rather than a second
// global declaration (two global declarations of the same property collide).
type MMGISAPIWithConfigMethods = MMGISAPI & {
    getLayerConfigs?: () => any
    getVisibleLayers?: () => Record<string, boolean>
}

const configAPI = (): MMGISAPIWithConfigMethods | undefined =>
    window.mmgisAPI as MMGISAPIWithConfigMethods | undefined

export const mmgisGetLayerConfigs = (): any => {
    return configAPI()?.getLayerConfigs?.() || {}
}

export const mmgisGetVisibleLayers = (): Record<string, boolean> => {
    return configAPI()?.getVisibleLayers?.() || {}
}
