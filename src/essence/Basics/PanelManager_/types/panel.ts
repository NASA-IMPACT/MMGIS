import { ToolOrientation, ToolMetadata } from '../../ToolController_/types/tool';
import {
    PanelPosition,
    EdgePanelPosition,
    FloatPanelPosition,
    PanelState,
    PanelLayoutType,
} from './layout';

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

    /**
     * CSS sizing for floating panels — applied directly as CSS properties on the panel element.
     * Numbers are treated as px; strings are passed through as-is (e.g. "50%", "40vh", "300px").
     *
     * Distinct from PanelCapabilities.minSize/maxSize, which constrain drag-resize handles
     * (single-axis, pixels only). These apply to both axes and support all CSS units.
     */
    defaultWidth?: number | string;
    defaultHeight?: number | string;
    minWidth?: number | string;
    maxWidth?: number | string;
    minHeight?: number | string;
    maxHeight?: number | string;
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
     * Default: false. Not supported on floating panels — dragging happens
     * via move handles instead, so this must be false/omitted there.
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
 * Fields shared by every panel, regardless of whether it's an edge or
 * floating panel.
 */
interface BasePanelConfig {
    /** Unique identifier for this panel */
    id: string;

    /** Display title for the panel */
    title?: string;

    /** Which states are allowed and what the default state is */
    stateConstraints: PanelStateConstraints;

    /** Size configuration for different states */
    dimensions?: PanelDimensions;

    /** Panel capabilities and constraints */
    capabilities?: PanelCapabilities;

    /**
     * Whether the panel should have a visible header with title and control buttons.
     * Default: false
     */
    hasHeader?: boolean;

    /**
     * Whether the panel should overlay the map when visible.
     * If false, map adjusts to make room for the panel.
     * Default: true (panels overlay map content)
     */
    overlay?: boolean;

    /**
     * Array of tools assigned to this panel.
     * Can be tool names (e.g., "Title") or tool IDs (e.g., "Title_instance1") for multiple instances.
     */
    panelTools?: string[];
}

/**
 * Configuration for an edge panel (top/left/right/bottom).
 * Edge panels compete for viewport space, so `priority` (stacking/allocation
 * order) and `layoutType` (how multiple tools are arranged) are required.
 */
export interface EdgePanelConfig extends BasePanelConfig {
    /** Which edge region this panel occupies */
    position: EdgePanelPosition;

    /**
     * Layout priority for space allocation.
     * Lower numbers claim viewport space first.
     * Example: top=0, right=1, bottom=2, left=3
     */
    priority: PanelPriority;

    /** How tools are laid out when panel is in 'expanded' state */
    layoutType: PanelLayoutType;
}

/**
 * Configuration for a floating panel, rendered as an overlay inside the
 * center map area. Floats don't compete for edge viewport space, so
 * `priority` and `layoutType` are optional, and drag-resize isn't supported.
 */
export interface FloatPanelConfig extends BasePanelConfig {
    /** Which float zone this panel occupies */
    position: FloatPanelPosition;

    /**
     * Not used for float layout/rendering, but still affects fallback tool
     * assignment: ToolControllerModern_._findPanel picks the first compatible
     * panel from the combined edge+float priority order, so a low priority
     * here can out-rank an edge panel for an unassigned tool.
     */
    priority?: PanelPriority;

    /** Accepted but inert for floats — _renderFloatRegions always stacks tools regardless of this value */
    layoutType?: PanelLayoutType;

    /** Floats can't be drag-resized; `resizable` must be false/omitted */
    capabilities?: Omit<PanelCapabilities, 'resizable'> & { resizable?: false };

    /**
     * Whether the layout paints no surface for this panel — no background,
     * border or shadow on the panel, and none on the cards behind its tools.
     * Tools keep whatever surfaces they draw themselves, so a tool that brings
     * its own boxes (map controls, for instance) sits directly on the map.
     * Default: false
     */
    transparent?: boolean;
}

/**
 * Complete configuration for a panel region.
 * Defines behavior, constraints, and appearance.
 */
export type PanelConfig = EdgePanelConfig | FloatPanelConfig;

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

    /**
     * Which tool is currently focused or active.
     * - In 'focused' state: tracks which single tool is open.
     * - In 'expanded' state with 'tabbed' layout: tracks the currently active tab.
     */
    activeToolId?: string;

    /**
     * Tool metadata for tools in this panel.
     * Map maintains insertion order (ES2015+).
     * Key: tool id, Value: tool metadata
     */
    tools: Map<string, ToolMetadata>;

    /**
     * Current actual size in pixels (dynamically updated).
     * Useful for animations, transitions, and layout calculations.
     */
    currentSize?: number;

    /**
     * The last non-collapsed state the panel was in.
     */
    lastVisibleState?: PanelState;
}

/** Result of a state-changing panel command. */
export type PanelCommandResult =
    | { ok: true; state: PanelState; changed: boolean }
    | { ok: false; reason: 'not-found' | 'state-not-allowed' | 'no-visible-state' };

/** The public shape of a panel — everything a caller needs to target one. */
export type PanelInfo = {
    id: string;
    position: string;
    state: PanelState;
    toolIds: string[];
};

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
     * Unregister a panel and remove it from the layout.
     * Should be called when a panel is being removed from the dashboard.
     *
     * @param panelId Panel identifier to unregister
     * @throws Error if panel not found
     */
    unregisterPanel(panelId: string): void;

    /**
     * Add a tool to a panel region.
     * Tools are assigned at dashboard creation time.
     * Validates tool compatibility against panel capabilities.
     *
     * @param panelId ID of the panel to add tool to
     * @param toolMetadata Tool metadata (orientation, compatibility, etc.)
     * @throws Error if tool is incompatible with panel
     * @throws Error if panel is at max capacity
     */
    addToolToPanel(panelId: string, toolMetadata: ToolMetadata): void;

    /**
     * Remove a tool from a panel.
     * Cleans up tool metadata and adjusts active tool if necessary.
     *
     * @param panelId ID of the panel to remove tool from
     * @param toolId Tool identifier to remove
     * @throws Error if panel not found
     * @throws Error if tool not found in panel
     */
    removeToolFromPanel(panelId: string, toolId: string): void;

    /**
     * Get the current state object for a panel.
     *
     * @param panelId Panel identifier
     * @returns Panel state or undefined if not found
     */
    getPanelState(panelId: string): PanelStateObject | undefined;

    /**
     * Get tool metadata for all tools in a panel.
     *
     * @param panelId Panel identifier
     * @returns Array of tool metadata or empty array if panel not found
     */
    getToolsForPanel(panelId: string): ToolMetadata[];

    /**
     * Whether a panel may enter the given state.
     *
     * @param panelId Panel identifier
     * @param newState Candidate state
     * @returns true if the transition is allowed
     */
    canSetState(panelId: string, newState: PanelState): boolean;

    /**
     * Change a panel's visual state.
     * Validates transition is allowed based on stateConstraints.
     *
     * @param panelId Panel identifier
     * @param newState Target state
     * @returns Command result: `{ ok: true, state, changed }` or `{ ok: false, reason }`
     */
    setPanelState(panelId: string, newState: PanelState): PanelCommandResult;

    /**
     * When in iconified or focused state, focus on a specific tool.
     * Transitions panel from iconified to 'focused' state and displays only the specified tool.
     *
     * @param panelId Panel identifier
     * @param toolId Tool to focus on
     * @throws Error if panel is not in iconified or focused state
     * @throws Error if tool not found in panel
     */
    focusTool(panelId: string, toolId: string): void;

    /**
     * Restore a collapsed panel to a visible state.
     * Behavior depends on current state and constraints:
     * - collapsed -> last visible state (or default state, or first available visible state)
     *
     * @param panelId Panel identifier
     * @returns Command result: `{ ok: true, state, changed }` or `{ ok: false, reason }`
     */
    showPanel(panelId: string): PanelCommandResult;

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
     * Public projection of every panel, ordered by priority.
     *
     * @returns Frozen array of the public panel shape
     */
    list(): PanelInfo[];

    /**
     * Broadcast that panel state has changed and layout needs updating.
     * Should be called whenever:
     * - Panel state changes
     * - Panel is added/removed
     */
    notifyChanged(): void;

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
