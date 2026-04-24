import { ToolOrientation, ToolMetadata } from '../ToolController_/types/tool';
import { PanelPosition, PanelState, PanelLayoutType, PANEL_STATE } from './types/layout';
import { PanelConfig, PanelStateObject, PanelManager as PanelManagerInterface } from './types/panel';

class PanelManager implements PanelManagerInterface {
    private panels: Map<string, PanelStateObject> = new Map();

    /**
     * Register a panel configuration.
     * Should be called during dashboard initialization.
     *
     * @param config Panel configuration
     * @throws Error if panel with same ID already exists
     */
    registerPanel(config: PanelConfig): void {
        if (this.panels.has(config.id)) {
            throw new Error(`Panel with ID ${config.id} already exists`);
        }

        // Validate that defaultState is in allowedStates
        const { defaultState, allowedStates } = config.stateConstraints;
        if (!allowedStates.includes(defaultState)) {
            throw new Error(
                `Invalid configuration for panel ${config.id}: defaultState '${defaultState}' is not in allowedStates [${allowedStates.join(', ')}]`
            );
        }

        // Initialize state object
        const stateObj: PanelStateObject = {
            id: config.id,
            state: config.stateConstraints.defaultState,
            config: config,
            containerId: `panel-${config.id}`,
            tools: new Map(),
        };

        this.panels.set(config.id, stateObj);
        this.notifyLayoutChanged();
    }

    /**
     * Unregister a panel and remove it from the layout.
     * Should be called when a panel is being removed from the dashboard.
     *
     * @param panelId Panel identifier to unregister
     * @throws Error if panel not found
     */
    unregisterPanel(panelId: string): void {
        if (!this.panels.has(panelId)) {
            throw new Error(`Panel with ID ${panelId} not found`);
        }

        this.panels.delete(panelId);
        this.notifyLayoutChanged();
    }

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
    addToolToPanel(panelId: string, toolMetadata: ToolMetadata): void {
        const panel = this.panels.get(panelId);
        if (!panel) {
            throw new Error(`Panel with ID ${panelId} not found`);
        }

        if (!this.isToolCompatible(panelId, toolMetadata)) {
            throw new Error(`Tool ${toolMetadata.id} is not compatible with panel ${panelId}`);
        }

        const maxTools = panel.config.capabilities?.maxTools;
        if (maxTools !== undefined && panel.tools.size >= maxTools) {
            throw new Error(`Panel ${panelId} is at maximum capacity (${maxTools})`);
        }

        panel.tools.set(toolMetadata.id, toolMetadata);

        // Automatically set active tool if in focused state and this is the first tool
        if (panel.state === PANEL_STATE.FOCUSED && panel.tools.size === 1) {
            panel.activeToolId = toolMetadata.id;
        }
    }

    /**
     * Remove a tool from a panel.
     * Cleans up tool metadata and adjusts active tool if necessary.
     *
     * @param panelId ID of the panel to remove tool from
     * @param toolId Tool identifier to remove
     * @throws Error if panel not found
     * @throws Error if tool not found in panel
     */
    removeToolFromPanel(panelId: string, toolId: string): void {
        const panel = this.panels.get(panelId);
        if (!panel) {
            throw new Error(`Panel with ID ${panelId} not found`);
        }

        if (!panel.tools.has(toolId)) {
            throw new Error(`Tool ${toolId} not found in panel ${panelId}`);
        }

        // Remove tool from map
        panel.tools.delete(toolId);

        // Handle active tool adjustment
        if (panel.activeToolId === toolId) {
            // Set active tool to the first available tool, or undefined if no tools left
            const firstToolId = panel.tools.keys().next().value;
            panel.activeToolId = firstToolId;
        }

        this.notifyLayoutChanged();
    }

    /**
     * Get the current state object for a panel.
     *
     * @param panelId Panel identifier
     * @returns Panel state or undefined if not found
     */
    getPanelState(panelId: string): PanelStateObject | undefined {
        return this.panels.get(panelId);
    }

    /**
     * Get tool metadata for all tools in a panel.
     *
     * @param panelId Panel identifier
     * @returns Array of tool metadata or empty array if panel not found
     */
    getToolsForPanel(panelId: string): ToolMetadata[] {
        const panel = this.panels.get(panelId);
        if (!panel) return [];

        return Array.from(panel.tools.values());
    }

    /**
     * Change a panel's visual state.
     * Validates transition is allowed based on stateConstraints.
     *
     * @param panelId Panel identifier
     * @param newState Target state
     * @throws Error if transition is not allowed
     */
    setPanelState(panelId: string, newState: PanelState): void {
        const panel = this.panels.get(panelId);
        if (!panel) {
            throw new Error(`Panel with ID ${panelId} not found`);
        }

        if (!panel.config.stateConstraints.allowedStates.includes(newState)) {
            throw new Error(`State transition to ${newState} is not allowed for panel ${panelId}`);
        }

        // Track last visible state when collapsing
        if (newState === PANEL_STATE.COLLAPSED && panel.state !== PANEL_STATE.COLLAPSED) {
            panel.lastVisibleState = panel.state;
        }

        panel.state = newState;
        this.notifyLayoutChanged();
    }

    /**
     * When in iconified or focused state, focus on a specific tool.
     * Transitions panel from iconified to 'focused' state and displays only the specified tool.
     *
     * @param panelId Panel identifier
     * @param toolId Tool to focus on
     * @throws Error if panel is not in iconified or focused state
     * @throws Error if tool not found in panel
     */
    focusTool(panelId: string, toolId: string): void {
        const panel = this.panels.get(panelId);
        if (!panel) {
            throw new Error(`Panel with ID ${panelId} not found`);
        }

        // Only allow from iconified or focused states
        if (panel.state !== PANEL_STATE.ICONIFIED && panel.state !== PANEL_STATE.FOCUSED) {
            throw new Error(
                `Cannot focus tool when panel is ${panel.state}. ` +
                `Panel must be in iconified or focused state.`
            );
        }

        if (!panel.tools.has(toolId)) {
            throw new Error(`Tool ${toolId} not found in panel ${panelId}`);
        }

        if (panel.state === PANEL_STATE.ICONIFIED) {
            this.setPanelState(panelId, PANEL_STATE.FOCUSED);
        }

        panel.activeToolId = toolId;
        this.notifyLayoutChanged();
    }

    /**
     * Toggle a panel's visibility.
     * Behavior depends on current state and constraints:
     * - collapsed -> last visible state (or default state, or first available visible state)
     * - iconified/focused/expanded -> collapsed
     *
     * @param panelId Panel identifier
     * @throws Error if panel not found
     * @throws Error if toggle cannot be performed due to state constraints
     */
    togglePanelCollapsed(panelId: string): void {
        const panel = this.panels.get(panelId);
        if (!panel) {
            throw new Error(`Panel with ID ${panelId} not found`);
        }

        const allowed = panel.config.stateConstraints.allowedStates;

        if (panel.state === PANEL_STATE.COLLAPSED) {
            // Try to restore last visible state first
            let targetState: PanelState = panel.lastVisibleState || panel.config.stateConstraints.defaultState;

            // If target is collapsed or not allowed, try to find a visible state
            if (targetState === PANEL_STATE.COLLAPSED || !allowed.includes(targetState)) {
                targetState = allowed.includes(PANEL_STATE.EXPANDED) ? PANEL_STATE.EXPANDED :
                            allowed.includes(PANEL_STATE.ICONIFIED) ? PANEL_STATE.ICONIFIED :
                            allowed.includes(PANEL_STATE.FOCUSED) ? PANEL_STATE.FOCUSED : PANEL_STATE.COLLAPSED;
            }

            if (targetState === PANEL_STATE.COLLAPSED) {
                throw new Error(
                    `Cannot uncollapse panel ${panelId}: no visible states available in constraints`
                );
            }

            this.setPanelState(panelId, targetState);
        } else {
            // Check if we can collapse
            if (!allowed.includes(PANEL_STATE.COLLAPSED)) {
                throw new Error(
                    `Cannot collapse panel ${panelId}: collapsed state not allowed in constraints`
                );
            }

            // setPanelState will automatically track lastVisibleState
            this.setPanelState(panelId, PANEL_STATE.COLLAPSED);
        }
    }

    /**
     * Get all panels for a specific position, ordered by priority.
     *
     * @param position Panel position/region
     * @returns Array of panel states, sorted by priority (lowest first)
     */
    getPanelsAtPosition(position: PanelPosition): PanelStateObject[] {
        return Array.from(this.panels.values())
            .filter(p => p.config.position === position)
            .sort((a, b) => a.config.priority - b.config.priority);
    }

    /**
     * Get all panels ordered by priority for layout calculations.
     * Used by layout engine to allocate viewport space.
     *
     * @returns Array of all panel states, sorted by priority (lowest first)
     */
    getAllPanelsByPriority(): PanelStateObject[] {
        return Array.from(this.panels.values())
            .sort((a, b) => a.config.priority - b.config.priority);
    }

    /**
     * Notify UI layer that panel state has changed and layout needs updating.
     * Should be called whenever:
     * - Panel state changes
     * - Panel is added/removed
     */
    notifyLayoutChanged(): void {
        const allPanels = this.getAllPanelsByPriority();
        // Fire custom event for any listeners hooked into the DOM.
        // TODO: Use eventbus for dispatching event. 
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('mmgis-panel-layout-changed', {
                detail: { panels: allPanels }
            }));
        }
    }

    /**
     * Validate if a tool is compatible with a panel.
     * Checks orientation, position constraints, and capacity.
     *
     * @param panelId Panel to validate against
     * @param toolMetadata Tool to validate
     * @returns true if compatible, false otherwise
     */
    isToolCompatible(panelId: string, toolMetadata: ToolMetadata): boolean {
        const panel = this.panels.get(panelId);
        if (!panel) return false;

        const { capabilities, position } = panel.config;

        // Check explicit position compatibility
        if (toolMetadata.compatiblePositions && toolMetadata.compatiblePositions.length > 0) {
            if (!toolMetadata.compatiblePositions.includes(position)) {
                return false;
            }
        }

        // Check orientation compatibility
        const requiredOrientation = toolMetadata.requiredOrientation;
        const supportedOrientation = capabilities?.supportedOrientation;

        if (supportedOrientation && requiredOrientation !== 'any') {
            if (supportedOrientation !== 'any' && supportedOrientation !== requiredOrientation) {
                return false;
            }
        }

        return true;
    }

    /**
     * Update a panel's size after a user drag resize event
     *
     * @param panelId Panel identifier
     * @param newSize New size in pixels
     * @throws Error if panel not found
     */
    resizePanel(panelId: string, newSize: number): void {
        const panel = this.panels.get(panelId);
        if (!panel) {
            throw new Error(`Panel with ID ${panelId} not found`);
        }

        if (!panel.config.capabilities?.resizable) {
            return;
        }

        const { minSize = 0, maxSize = Infinity } = panel.config.capabilities;
        const boundedSize = Math.max(minSize, Math.min(newSize, maxSize));

        panel.currentSize = boundedSize;
        this.notifyLayoutChanged();
    }
}

const PanelManager_ = new PanelManager();
export default PanelManager_;

export { PanelManager };
