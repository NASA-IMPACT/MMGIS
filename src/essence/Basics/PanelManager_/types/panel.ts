import { ToolOrientation, ToolMetadata } from './tool';
import { PanelPosition, PanelState, PanelLayoutType } from './layout';

/**
 * Panel size configuration.
 * Can be fixed pixels, full viewport, content-based, or constrained.
 */
export type PanelSize =
    | number                                    // Fixed pixels (e.g., 300)
    | 'content'                                 // Size based on content (grows to fit)
    | { min?: number; max?: number };           // Content-based with constraints

/**
 * Panel layout priority for viewport space allocation.
 * Lower numbers = higher priority (claim space first).
 *
 * Example layout:
 * - top panel (priority 0): Claims full width, say 60px height
 * - right panel (priority 1): Claims remaining height, say 300px width
 * - bottom panel (priority 2): Claims remaining width (minus right), say 200px height
 * - left panel (priority 3): Gets all remaining space
 */
export type PanelPriority = number;

/**
 * State constraints for a panel based on position and configuration.
 * Example: Top panels typically only allow 'collapsed' and 'expanded', not 'iconified' or 'focused'
 */
export interface PanelStateConstraints {
    /** Which states this panel is allowed to transition to */
    allowedStates: PanelState[];

    /** Initial state when panel is first created */
    defaultState: PanelState;
}

/**
 * State-specific dimensions configuration.
 * Panel size can vary based on its current state.
 *
 * For horizontal panels (top/bottom): size refers to height (width is always full)
 * For vertical panels (left/right): size refers to width (height is always full)
 */
export interface PanelDimensions {
    /**
     * Size of the icon bar when in iconified state (pixels).
     * Always a fixed number.
     * - For left/right panels: width of vertical icon bar
     * - For top/bottom panels: height of horizontal icon bar
     */
    iconifiedSize?: number;

    /**
     * Size when a single tool is opened from iconified state (focused state).
     */
    focusedHeight?: PanelSize;
    focusedWidth?: PanelSize;

    /**
     * Size when all tools are visible (expanded state).
     * - For top/bottom: this is the height
     * - For left/right: this is the width
     */
    expandedSize?: PanelSize;
}

/**
 * Panel capabilities and constraints.
 * Defines what this panel can and cannot do.
 */
export interface PanelCapabilities {
    /**
     * What tool orientations this panel supports.
     * - Top panel: 'horizontal' only (rejects vertical tools)
     * - Side panels: usually 'vertical' or 'any'
     */
    supportedOrientation?: ToolOrientation;

    /**
     * Maximum number of tools allowed in this panel.
     * undefined = no limit
     */
    maxTools?: number;

    /**
     * Whether this panel can be resized by the user via drag handles.
     * Default: false
     */
    resizable?: boolean;

    /**
     * Minimum size constraint for user resizing (pixels).
     * Only relevant if resizable = true.
     */
    minSize?: number;

    /**
     * Maximum size constraint for user resizing (pixels).
     * Only relevant if resizable = true.
     */
    maxSize?: number;
}

/**
 * Complete configuration for a panel region.
 * Defines behavior, constraints, and appearance.
 */
export interface PanelConfig {
    /** Unique identifier for this panel */
    id: string;

    /** Display title for the panel */
    title?: string;

    /** Which region this panel occupies */
    position: PanelPosition;

    /**
     * Layout priority for space allocation.
     * Lower numbers claim viewport space first.
     * Example: top=0, right=1, bottom=2, left=3
     */
    priority: PanelPriority;

    /** How tools are laid out when panel is in 'expanded' state */
    layoutType: PanelLayoutType;

    /** Which states are allowed and what the default state is */
    stateConstraints: PanelStateConstraints;

    /** Size configuration for different states */
    dimensions?: PanelDimensions;

    /** Panel capabilities and constraints */
    capabilities?: PanelCapabilities;

    /**
     * Whether the panel should overlay the map when visible.
     * If false, map adjusts to make room for the panel.
     * Default: true (panels overlay map content)
     */
    overlay?: boolean;
}

/**
 * Runtime state object for an active panel.
 * Tracks current state, configuration, and associated tools.
 */
export interface PanelStateObject {
    /** Unique identifier matching PanelConfig.id */
    id: string;

    /** Current visual state */
    state: PanelState;

    /** Configuration for this panel */
    config: PanelConfig;

    /** ID of the DOM container element for this panel */
    containerId: string;

    /** List of tool names assigned to this panel region */
    tools: string[];

    /**
     * Which tool is currently focused or active.
     * - In 'focused' state: tracks which single tool is open.
     * - In 'expanded' state with 'tabbed' layout: tracks the currently active tab.
     */
    activeToolId?: string;

    /**
     * Reference to tool instances for this panel.
     * Key: tool name, Value: tool instance object
     */
    toolInstances?: Record<string, any>;

    /**
     * Current actual size in pixels (dynamically updated).
     * Useful for animations, transitions, and layout calculations.
     */
    currentSize?: number;
}

/**
 * Interface for the PanelManager singleton.
 * Manages all panel regions and their states.
 */
export interface PanelManager {
    /**
     * Register a panel configuration.
     * Should be called during dashboard initialization.
     *
     * @param config Panel configuration
     * @throws Error if panel with same ID already exists
     */
    registerPanel(config: PanelConfig): void;

    /**
     * Add a tool to a panel region.
     * Tools are assigned at dashboard creation time.
     * Validates tool compatibility against panel capabilities.
     *
     * @param panelId ID of the panel to add tool to
     * @param toolMetadata Tool metadata (orientation, compatibility, etc.)
     * @param toolInstance The tool instance object
     * @throws Error if tool is incompatible with panel
     * @throws Error if panel is at max capacity
     */
    addToolToPanel(panelId: string, toolMetadata: ToolMetadata, toolInstance?: any): void;

    /**
     * Get the current state object for a panel.
     *
     * @param panelId Panel identifier
     * @returns Panel state or undefined if not found
     */
    getPanelState(panelId: string): PanelStateObject | undefined;

    /**
     * Change a panel's visual state.
     * Validates transition is allowed based on stateConstraints.
     *
     * @param panelId Panel identifier
     * @param newState Target state
     * @throws Error if transition is not allowed
     */
    setPanelState(panelId: string, newState: PanelState): void;

    /**
     * When in iconified state, focus on a specific tool.
     * Transitions panel to 'focused' state and displays only the specified tool.
     *
     * @param panelId Panel identifier
     * @param toolId Tool to focus on
     * @throws Error if panel is not in iconified state
     * @throws Error if tool not found in panel
     */
    focusTool(panelId: string, toolId: string): void;

    /**
     * Toggle a panel's collapsed state.
     * Behavior depends on current state and constraints:
     * - collapsed -> last non-collapsed state (or expanded)
     * - iconified/focused/expanded -> collapsed
     *
     * @param panelId Panel identifier
     */
    togglePanelCollapsed(panelId: string): void;

    /**
     * Get all panels for a specific position, ordered by priority.
     *
     * @param position Panel position/region
     * @returns Array of panel states, sorted by priority (lowest first)
     */
    getPanelsAtPosition(position: PanelPosition): PanelStateObject[];

    /**
     * Get all panels ordered by priority for layout calculations.
     * Used by layout engine to allocate viewport space.
     *
     * @returns Array of all panel states, sorted by priority (lowest first)
     */
    getAllPanelsByPriority(): PanelStateObject[];

    /**
     * Calculate and apply layout based on panel priorities and states.
     * Allocates viewport space to panels in priority order.
     * Should be called whenever:
     * - Panel state changes
     * - Viewport resizes
     * - Panel is added/removed
     */
    recalculateLayout(): void;

    /**
     * Validate if a tool is compatible with a panel.
     * Checks orientation, position constraints, and capacity.
     *
     * @param panelId Panel to validate against
     * @param toolMetadata Tool to validate
     * @returns true if compatible, false otherwise
     */
    isToolCompatible(panelId: string, toolMetadata: ToolMetadata): boolean;

    /**
     * Update a panel's size after a user drag resize event
     * 
     * @param panelId Panel identifier
     * @param newSize New size in pixels
     */
    resizePanel(panelId: string, newSize: number): void;
}
