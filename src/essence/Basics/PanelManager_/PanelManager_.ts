import { ToolOrientation, ToolMetadata } from '../ToolController_/types/tool';
import { PanelPosition, PanelState, PanelLayoutType, PANEL_STATE, FLOAT_POSITIONS } from './types/layout';
import {
    PanelConfig,
    PanelStateObject,
    PanelManager as PanelManagerInterface,
    PanelCommandResult,
    PanelInfo,
} from './types/panel';
import { mmgisAPI } from '../../mmgisAPI/mmgisAPI';

/**
 * Float panels don't require a priority (they don't compete for edge viewport
 * space), so `config.priority` may be undefined. Treat missing priority as
 * lowest priority (sorts last) instead of letting `undefined - undefined`
 * produce NaN, which Array.prototype.sort treats as "leave order unchanged"
 * and yields insertion-order-dependent, effectively unsorted results.
 */
function normalizePriority(priority: number | undefined): number {
    return priority === undefined ? Infinity : priority;
}

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
        this.notifyChanged();
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
        this.notifyChanged();
    }

    /**
     * Drop every panel at once, as a layout teardown does.
     */
    clear(): void {
        if (this.panels.size === 0) return;

        this.panels.clear();
        this.notifyChanged();
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

        this.notifyChanged();
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
     * Whether a panel may enter the given state. Float panels support only
     * collapsed and expanded; every panel is additionally bound by its
     * configured allowedStates.
     */
    canSetState(panelId: string, newState: PanelState): boolean {
        const panel = this.panels.get(panelId);
        if (!panel) return false;

        if ((FLOAT_POSITIONS as Set<string>).has(panel.config.position) &&
            (newState === PANEL_STATE.ICONIFIED || newState === PANEL_STATE.FOCUSED)) {
            return false;
        }

        return panel.config.stateConstraints.allowedStates.includes(newState);
    }

    /**
     * Move a panel to a state. Idempotent: asking for the state a panel already
     * holds succeeds without notifying, so repeated or retried commands cannot
     * produce spurious layout churn.
     */
    setPanelState(panelId: string, newState: PanelState): PanelCommandResult {
        const panel = this.panels.get(panelId);
        if (!panel) return { ok: false, reason: 'not-found' };
        if (!this.canSetState(panelId, newState)) return { ok: false, reason: 'state-not-allowed' };

        if (panel.state === newState) return { ok: true, state: newState, changed: false };

        if (newState === PANEL_STATE.COLLAPSED) {
            panel.lastVisibleState = panel.state;
        }

        panel.state = newState;
        this.notifyChanged();
        return { ok: true, state: newState, changed: true };
    }

    /**
     * Restore a collapsed panel to the state it last held, falling back to its
     * configured default and then to any allowed visible state.
     *
     * A panel that is already visible stays exactly where it is. Show only ever
     * reveals; resolving a target for a panel the user has expanded would demote
     * it whenever the configured default is the smaller state, which is how
     * every stock layout configures its left panel.
     *
     * `iconified` counts as visible, and is where those same layouts start
     * their left panel: on a fresh load this succeeds with `changed: false`
     * and the panel stays an icon rail. A caller needing a usable panel reads
     * the `state` reported here and asks for a larger one.
     */
    showPanel(panelId: string): PanelCommandResult {
        const panel = this.panels.get(panelId);
        if (!panel) return { ok: false, reason: 'not-found' };
        if (panel.state !== PANEL_STATE.COLLAPSED) {
            return { ok: true, state: panel.state, changed: false };
        }

        const candidates: PanelState[] = [
            panel.lastVisibleState,
            panel.config.stateConstraints.defaultState,
            PANEL_STATE.EXPANDED,
            PANEL_STATE.ICONIFIED,
            PANEL_STATE.FOCUSED,
        ].filter(Boolean) as PanelState[];

        const target = candidates.find(
            (state) => state !== PANEL_STATE.COLLAPSED && this.canSetState(panelId, state)
        );

        if (!target) return { ok: false, reason: 'no-visible-state' };
        return this.setPanelState(panelId, target);
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
        this.notifyChanged();
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
            .sort((a, b) => normalizePriority(a.config.priority) - normalizePriority(b.config.priority));
    }

    /**
     * Get all panels ordered by priority for layout calculations.
     * Used by layout engine to allocate viewport space.
     *
     * @returns Array of all panel states, sorted by priority (lowest first)
     */
    getAllPanelsByPriority(): PanelStateObject[] {
        return Array.from(this.panels.values())
            .sort((a, b) => normalizePriority(a.config.priority) - normalizePriority(b.config.priority));
    }

    /**
     * Public projection of every panel, ordered by priority. Stripped of
     * `config`, the live `tools` map, and other core references, so it clones
     * cleanly across a sandbox postMessage boundary. Frozen on top of that so
     * a subscriber holding a reference can't mutate core's panel state.
     */
    list(): PanelInfo[] {
        return Object.freeze(
            this.getAllPanelsByPriority().map((panel) => {
                return Object.freeze({
                    id: panel.id,
                    position: panel.config.position,
                    state: panel.state,
                    toolIds: Object.freeze(Array.from(panel.tools.keys())),
                });
            })
        ) as PanelInfo[];
    }

    /**
     * Broadcast that the layout moved.
     */
    notifyChanged(): void {
        mmgisAPI.emit('panels:changed', Object.freeze({
            panels: this.list(),
        }));
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
        // Get orientation from tool metadata, default to 'any' if not specified
        const toolOrientation = toolMetadata.requiredOrientation || 'any';
        const supportedOrientation = capabilities?.supportedOrientation || 'any';

        // If either is 'any', they're compatible
        // Otherwise, they must match exactly
        if (toolOrientation !== 'any' && supportedOrientation !== 'any') {
            return toolOrientation === supportedOrientation;
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
        this.notifyChanged();
    }
}

const PanelManager_ = new PanelManager();
export default PanelManager_;

export { PanelManager };
