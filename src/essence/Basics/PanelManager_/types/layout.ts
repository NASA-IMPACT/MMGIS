/**
 * Supported panel positions (regions where panels can be placed).
 */
export const PANEL_POSITION = {
    TOP: 'top',
    LEFT: 'left',
    RIGHT: 'right',
    BOTTOM: 'bottom',
} as const
export type PanelPosition = (typeof PANEL_POSITION)[keyof typeof PANEL_POSITION]

/**
 * Visual states of a panel:
 * - collapsed: Hidden completely, takes no space in the viewport
 * - iconified: Shows tool icons only in a toolbar/sidebar
 * - focused: Single tool visible, opened from iconified state (user clicked an icon)
 * - expanded: All tools visible in configured layout (stacked/tabbed)
 */
export const PANEL_STATE = {
    COLLAPSED: 'collapsed',
    ICONIFIED: 'iconified',
    FOCUSED: 'focused',
    EXPANDED: 'expanded',
} as const
export type PanelState = (typeof PANEL_STATE)[keyof typeof PANEL_STATE]

/**
 * How multiple tools are displayed when panel is in 'expanded' state:
 * - stacked: All tools visible simultaneously, stacked vertically/horizontally
 * - tabbed: Tools in tabs, only one tool's content visible at a time
 */
export const PANEL_LAYOUT_TYPE = {
    STACKED: 'stacked',
    TABBED: 'tabbed',
} as const
export type PanelLayoutType = (typeof PANEL_LAYOUT_TYPE)[keyof typeof PANEL_LAYOUT_TYPE]
