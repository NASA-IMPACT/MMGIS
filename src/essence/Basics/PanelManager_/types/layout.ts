/**
 * Positions for edge panels (top/left/right/bottom), which claim viewport
 * space and therefore require a `priority` + `layoutType`.
 */
const EDGE_POSITION = {
    TOP: 'top',
    LEFT: 'left',
    RIGHT: 'right',
    BOTTOM: 'bottom',
} as const
export type EdgePanelPosition = (typeof EDGE_POSITION)[keyof typeof EDGE_POSITION]

/**
 * Positions for floating panels, which render as overlays inside the center
 * map area and don't compete for edge viewport space.
 */
const FLOAT_POSITION = {
    FLOAT_TOP_LEFT: 'float-top-left',
    FLOAT_TOP_CENTER: 'float-top-center',
    FLOAT_TOP_RIGHT: 'float-top-right',
    FLOAT_BOTTOM_LEFT: 'float-bottom-left',
    FLOAT_BOTTOM_CENTER: 'float-bottom-center',
    FLOAT_BOTTOM_RIGHT: 'float-bottom-right',
} as const
export type FloatPanelPosition = (typeof FLOAT_POSITION)[keyof typeof FLOAT_POSITION]

/**
 * Supported panel positions (regions where panels can be placed).
 */
export const PANEL_POSITION = { ...EDGE_POSITION, ...FLOAT_POSITION } as const
export type PanelPosition = EdgePanelPosition | FloatPanelPosition

/**
 * Set of all float positions for quick membership checks.
 * Float panels render inside the center map area as overlays.
 */
export const FLOAT_POSITIONS = new Set(Object.values(FLOAT_POSITION))

/**
 * Positions whose panels stack their tools along the vertical axis and scroll
 * that way. Only these support a pinned region, since pinning means holding
 * tools at the top while the rest of the stack scrolls under them.
 */
export const PINNABLE_POSITIONS: Set<string> = new Set([
    EDGE_POSITION.LEFT,
    EDGE_POSITION.RIGHT,
])

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
export const PANEL_STATES: readonly PanelState[] = Object.values(PANEL_STATE)

/**
 * Why a panel or plugin command was refused. Shared by both:
 * - bad-request: malformed payload — a missing or non-string id, or a state
 *   name outside the target's vocabulary
 * - not-found: a well-formed payload naming nothing that exists
 * - state-not-allowed: a real state this target forbids, per its configured
 *   constraints or its position
 * - no-visible-state: a panel with no non-collapsed state to reveal into
 * - layout-inactive: no layout is mounted
 * - load-failed: reaching the state needed a plugin load, and it threw
 * - transition-failed: the target resolved but the subsystem could not move it
 */
export const COMMAND_REFUSAL_REASONS = [
    'bad-request',
    'not-found',
    'state-not-allowed',
    'no-visible-state',
    'layout-inactive',
    'load-failed',
    'transition-failed',
] as const
export type CommandRefusalReason = (typeof COMMAND_REFUSAL_REASONS)[number]

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
