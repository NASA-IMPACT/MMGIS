<<<<<<< HEAD
import { ToolOrientation, ToolMetadata } from '../ToolController_/types/tool';
=======
import { ToolOrientation, ToolMetadata } from './types/tool';
>>>>>>> feat/panel-manager
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

        // Initialize state object
        const stateObj: PanelStateObject = {
            id: config.id,
            state: config.stateConstraints.defaultState,
            config: config,
            containerId: `panel-${config.id}`,
            tools: [],
            toolInstances: {},
        };

        this.panels.set(config.id, stateObj);
        this.recalculateLayout();
    }

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
    addToolToPanel(panelId: string, toolMetadata: ToolMetadata, toolInstance?: any): void {
        const panel = this.panels.get(panelId);
        if (!panel) {
            throw new Error(`Panel with ID ${panelId} not found`);
        }

        if (!this.isToolCompatible(panelId, toolMetadata)) {
            throw new Error(`Tool ${toolMetadata.id} is not compatible with panel ${panelId}`);
        }

        const maxTools = panel.config.capabilities?.maxTools;
        if (maxTools !== undefined && panel.tools.length >= maxTools) {
            throw new Error(`Panel ${panelId} is at maximum capacity (${maxTools})`);
        }

        panel.tools.push(toolMetadata.id);
        if (toolInstance) {
            if (!panel.toolInstances) {
                panel.toolInstances = {};
            }
            panel.toolInstances[toolMetadata.id] = toolInstance;
        }

        // Automatically set active tool if in focused state and this is the first tool
        if (panel.state === PANEL_STATE.FOCUSED && panel.tools.length === 1) {
            panel.activeToolId = toolMetadata.id;
        }
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

        panel.state = newState;
        this.recalculateLayout();
    }

    /**
     * When in iconified state, focus on a specific tool.
     * Transitions panel to 'focused' state and displays only the specified tool.
     *
     * @param panelId Panel identifier
     * @param toolId Tool to focus on
     * @throws Error if panel is not in iconified state
     * @throws Error if tool not found in panel
     */
    focusTool(panelId: string, toolId: string): void {
        const panel = this.panels.get(panelId);
        if (!panel) {
            throw new Error(`Panel with ID ${panelId} not found`);
        }

        if (panel.state !== PANEL_STATE.ICONIFIED && panel.state !== PANEL_STATE.FOCUSED && panel.state !== PANEL_STATE.EXPANDED) {
            if (panel.state === PANEL_STATE.COLLAPSED) {
                throw new Error(`Cannot focus tool when panel is collapsed`);
            }
        }

        if (!panel.tools.includes(toolId)) {
            throw new Error(`Tool ${toolId} not found in panel ${panelId}`);
        }

        if (panel.state === PANEL_STATE.ICONIFIED) {
            this.setPanelState(panelId, PANEL_STATE.FOCUSED);
        }

        panel.activeToolId = toolId;
        this.recalculateLayout();
    }

    /**
     * Toggle a panel's visibility.
     * Behavior depends on current state and constraints:
     * - collapsed -> last non-collapsed state (or expanded)
     * - iconified/focused/expanded -> collapsed
     *
     * @param panelId Panel identifier
     */
    togglePanelCollapsed(panelId: string): void {
        const panel = this.panels.get(panelId);
        if (!panel) return;

        if (panel.state === PANEL_STATE.COLLAPSED) {
            const allowed = panel.config.stateConstraints.allowedStates;
            let targetState: PanelState = panel.config.stateConstraints.defaultState;
            
            // If default is collapsed, try to find a visible state
            if (targetState === PANEL_STATE.COLLAPSED) {
                targetState = allowed.includes(PANEL_STATE.EXPANDED) ? PANEL_STATE.EXPANDED : 
                            allowed.includes(PANEL_STATE.ICONIFIED) ? PANEL_STATE.ICONIFIED : 
                            allowed.includes(PANEL_STATE.FOCUSED) ? PANEL_STATE.FOCUSED : PANEL_STATE.COLLAPSED;
            }
            if (targetState !== PANEL_STATE.COLLAPSED) {
                this.setPanelState(panelId, targetState);
            }
        } else {
            if (panel.config.stateConstraints.allowedStates.includes(PANEL_STATE.COLLAPSED)) {
                this.setPanelState(panelId, PANEL_STATE.COLLAPSED);
            }
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
     * Calculate and apply layout based on panel priorities and states.
     * Allocates viewport space to panels in priority order.
     */
    recalculateLayout(): void {
        const allPanels = this.getAllPanelsByPriority();
        // Fire custom event for any listeners hooked into the DOM.
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
     */
    resizePanel(panelId: string, newSize: number): void {
        const panel = this.panels.get(panelId);
        if (!panel) return;

        if (!panel.config.capabilities?.resizable) {
            return;
        }

        const { minSize = 0, maxSize = Infinity } = panel.config.capabilities;
        const boundedSize = Math.max(minSize, Math.min(newSize, maxSize));

        panel.currentSize = boundedSize;
        this.recalculateLayout();
    }
}

const PanelManager_ = new PanelManager();
export default PanelManager_;

export { PanelManager };
