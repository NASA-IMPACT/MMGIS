// Components
export { FloatingPopover, type FloatingPopoverProps } from './FloatingPopover/FloatingPopover'
export { DateSelector, type DateSelectorProps } from './geo/DateSelector/DateSelector'
export { LayerGroupSidebarItem, type LayerGroupSidebarItemProps } from './geo/LayerGroupSidebarItem/LayerGroupSidebarItem'
export { LayerNavControls, type LayerNavControlsProps } from './geo/LayerNavControls/LayerNavControls'
export { LayerSidebarItem, type LayerSidebarItemProps } from './geo/LayerSidebarItem/LayerSidebarItem'
export { LayerTimeline, type LayerTimelineProps } from './geo/LayerTimeline/LayerTimeline'
export { PlaybackControls, type PlaybackControlsProps } from './geo/PlaybackControls/PlaybackControls'
export { PlaybackSpeedControl, getNextPlaybackSpeed, PLAYBACK_SPEEDS, type PlaybackSpeedControlProps, type PlaybackSpeed } from './geo/PlaybackSpeedControl/PlaybackSpeedControl'
export { TimeModeControl, type TimeModeControlProps } from './geo/TimeModeControl/TimeModeControl'
export { TimelineView, type TimelineViewProps } from './geo/TimelineView/TimelineView'
export { ZoomControls, type ZoomControlsProps } from './geo/ZoomControls/ZoomControls'

// Shared domain types
export { TIME_MODE_ORDER } from './types'
export type { TimeMode, TimeRange, LayerTimeData } from './types'
export { drawnExtent, revealEnd, revealStart } from './utils/layerNavigation'
export type { LayerNavigation } from './utils/layerNavigation'
export { buildTimelineRows, mergeRanges } from './utils/layerGroups'
export type { LayerGroupNode, TimelineRow } from './utils/layerGroups'

// Zoom
export { useTimelineZoom, type TimelineZoom, type UseTimelineZoomOptions } from './hooks/useTimelineZoom'
export type { ViewWindow } from './utils/zoomWindow'
