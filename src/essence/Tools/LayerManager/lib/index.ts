export { LayerManagerPanel, type LayerManagerPanelProps } from './geo/LayerManagerPanel/LayerManagerPanel'
export { LayerLegendList, type LayerLegendListProps } from './geo/LayerLegendList/LayerLegendList'
export { LayerTreeList, type LayerTreeListProps } from './geo/LayerTreeList/LayerTreeList'
export {
    LayerLegend,
    type LayerLegendProps,
    type RenderDescription,
} from './geo/LayerLegend/LayerLegend'
export { GradientGraphic, type GradientGraphicProps } from './geo/GradientGraphic/GradientGraphic'
export { CategoricalGraphic, type CategoricalGraphicProps } from './geo/CategoricalGraphic/CategoricalGraphic'
export { ColorRampPicker, type ColorRampPickerProps } from './geo/ColorRampPicker/ColorRampPicker'
export { PopoverMenu, type PopoverMenuProps, type PopoverMenuItem } from './geo/PopoverMenu'
export { FloatingPopover, type FloatingPopoverProps } from './FloatingPopover'
export {
    DataCoverageWarning,
    type DataCoverageWarningProps,
} from './geo/DataCoverageWarning/DataCoverageWarning'

export type {
    Layer,
    LegendType,
    CategoricalStop,
    CogData,
    LayerGroup,
    LayerListNode,
    LayerStructureNode,
} from './types'
export {
    buildLayerList,
    placeInTree,
    resolveDrop,
    type Placement,
} from './utils/layerTree'

// Side-effect import of the component stylesheet.
import './styles/index.scss'
