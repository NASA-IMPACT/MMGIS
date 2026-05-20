export { LayerManagerPanel, type LayerManagerPanelProps } from './geo/LayerManagerPanel/LayerManagerPanel'
export { LayerLegendList, type LayerLegendListProps } from './geo/LayerLegendList/LayerLegendList'
export { LayerLegend, type LayerLegendProps } from './geo/LayerLegend/LayerLegend'
export { GradientGraphic, type GradientGraphicProps } from './geo/GradientGraphic/GradientGraphic'
export { CategoricalGraphic, type CategoricalGraphicProps } from './geo/CategoricalGraphic/CategoricalGraphic'
export { ColormapControl, type ColormapControlProps } from './geo/ColormapControl/ColormapControl'

export type { Layer, LegendType, CategoricalStop, CogData, Colormap } from './types'

// Stylesheet entry — consumers import this to load the compiled USWDS-themed CSS.
// In MMGIS the import path lives in MMGISLayerManagerAdapter; in monorepo consumers
// it will be imported from the published package's compiled CSS bundle.
import './styles/index.scss'
