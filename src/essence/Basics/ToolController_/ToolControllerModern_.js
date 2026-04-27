import PanelManager_ from '../PanelManager_/PanelManager_'
import { TOOL_ORIENTATION } from './types/tool'
import { toolModules } from '../../../pre/tools'
import { PANEL_POSITION } from '../PanelManager_/types/layout'

const ToolControllerModern_ = {
    /**
     * Map of loaded tool instances: targetId -> { toolInstance, toolName, toolId }
     */
    _loadedTools: new Map(),
    /**
     * Validate tool metadata and logs warnings for invalid configurations
     *
     * @param {Object} metadata - Tool metadata to validate
     * @returns {boolean} True if metadata is valid
     */
    validateToolMetadata: function(metadata) {
        const warnings = []

        // Check required fields
        if (!metadata || typeof metadata !== 'object') {
            console.error('[ToolControllerModern] Invalid metadata: not an object')
            return false
        }

        if (!metadata.id || typeof metadata.id !== 'string') {
            warnings.push('Missing or invalid required field: id')
        }

        if (!metadata.name || typeof metadata.name !== 'string') {
            warnings.push('Missing or invalid required field: name')
        }

        // Check requiredOrientation
        const validOrientations = [TOOL_ORIENTATION.HORIZONTAL, TOOL_ORIENTATION.VERTICAL, TOOL_ORIENTATION.ANY]
        if (!validOrientations.includes(metadata.requiredOrientation)) {
            warnings.push(`Invalid requiredOrientation: "${metadata.requiredOrientation}"`)
        }

        // Check compatiblePositions
        if (metadata.compatiblePositions) {
            if (!Array.isArray(metadata.compatiblePositions)) {
                warnings.push('compatiblePositions must be an array')
            } else {
                const validPositions = Object.values(PANEL_POSITION)
                const invalidPositions = metadata.compatiblePositions.filter(
                    pos => !validPositions.includes(pos)
                )
                if (invalidPositions.length > 0) {
                    warnings.push(`Invalid compatiblePositions: ${invalidPositions.join(', ')}`)
                }
            }
        }

        // Check preferredPosition
        if (metadata.preferredPosition) {
            const validPositions = Object.values(PANEL_POSITION)
            if (!validPositions.includes(metadata.preferredPosition)) {
                warnings.push(`Invalid preferredPosition: "${metadata.preferredPosition}"`)
            }

            // Check if preferredPosition is in compatiblePositions
            if (metadata.compatiblePositions &&
                Array.isArray(metadata.compatiblePositions) &&
                !metadata.compatiblePositions.includes(metadata.preferredPosition)) {
                warnings.push(
                    `preferredPosition "${metadata.preferredPosition}" not in compatiblePositions`
                )
            }
        }

        if (warnings.length > 0) {
            console.warn(
                `[ToolControllerModern] Tool "${metadata.name || 'Unknown'}" has metadata issues:`,
                warnings
            )
        }

        return warnings.length === 0
    },

    /**
     * Generate tool metadata from tool configuration
     * Reads metadata from toolConfig.metadata (from toolConfigs.json) if available
     *
     * @param {Object} toolConfig - Tool configuration from mission config
     * @param {string} toolConfig.name - Tool name
     * @param {string} toolConfig.icon - Tool icon
     * @param {string} toolConfig.js - Tool JS module name
     * @param {Object} toolConfig.metadata - Tool metadata from toolConfigs.json
     * @returns {Object} Tool metadata object
     */
    generateToolMetadata: function (toolConfig) {
        const toolName = toolConfig.name || 'Unknown'
        const toolId = toolConfig.js || toolName.toLowerCase().replace(/\s+/g, '-')

        // Read metadata from toolConfig (declared in toolConfigs.json)
        const declaredMetadata = toolConfig.metadata || {}

        // Build metadata with defaults
        const metadata = {
            id: toolId,
            name: toolName,
            requiredOrientation: declaredMetadata.requiredOrientation || TOOL_ORIENTATION.ANY,
            icon: toolConfig.icon || toolConfig.defaultIcon || 'cog'
        }

        // Add optional fields if present in declared metadata
        if (declaredMetadata.compatiblePositions) {
            metadata.compatiblePositions = declaredMetadata.compatiblePositions
        }

        if (declaredMetadata.preferredPosition) {
            metadata.preferredPosition = declaredMetadata.preferredPosition
        }

        if (declaredMetadata.modernLayoutSupport !== undefined) {
            metadata.modernLayoutSupport = declaredMetadata.modernLayoutSupport
        }

        // Validate metadata in debug mode
        if (window.mmgisglobal?.debug) {
            ToolControllerModern_.validateToolMetadata(metadata)
        }

        return metadata
    },

    /**
     * Build tool configuration maps for efficient lookup
     * @param {Array} tools - Array of tool configurations
     * @returns {Object} Object containing toolConfigMap and getToolData helper
     */
    buildToolConfigMap: function (tools) {
        const toolConfigMap = new Map() // id -> { config, metadata }
        const toolNameToId = new Map() // name -> id

        tools.forEach(toolConfig => {
            const toolMetadata = ToolControllerModern_.generateToolMetadata(toolConfig)

            // Store by ID (primary key)
            if (toolConfigMap.has(toolMetadata.id)) {
                console.warn(`[ToolControllerModern] Duplicate tool ID detected: ${toolMetadata.id}`)
            }
            toolConfigMap.set(toolMetadata.id, { config: toolConfig, metadata: toolMetadata })

            // Map name to ID for lookup
            if (toolNameToId.has(toolMetadata.name)) {
                console.warn(`[ToolControllerModern] Duplicate tool name detected: ${toolMetadata.name}`)
            }
            toolNameToId.set(toolMetadata.name, toolMetadata.id)
        })

        // Helper function to get tool data by name or ID
        const getToolData = (nameOrId) => {
            const id = toolNameToId.get(nameOrId) || nameOrId
            return toolConfigMap.get(id)
        }

        return { toolConfigMap, toolNameToId, getToolData }
    },

    /**
     * Assign tools explicitly defined in panel configurations
     * @param {Array} registeredPanels - List of registered panels
     * @param {Function} getToolData - Function to get tool data by name or ID
     * @param {Set} assignedToolIds - Set to track assigned tool IDs
     */
    assignExplicitTools: function (registeredPanels, getToolData, assignedToolIds) {
        registeredPanels.forEach(panelState => {
            const panelConfig = panelState.config
            const panelTools = panelConfig.toolNames || []

            panelTools.forEach(toolName => {
                const toolData = getToolData(toolName)

                if (!toolData) {
                    console.warn(`[ToolControllerModern] Tool "${toolName}" specified in panel "${panelConfig.id}" not found in tools config`)
                    return
                }

                try {
                    const { metadata } = toolData

                    // Check compatibility
                    if (!PanelManager_.isToolCompatible(panelConfig.id, metadata)) {
                        console.warn(`[ToolControllerModern] Tool "${metadata.name}" is not compatible with panel "${panelConfig.id}"`)
                        return
                    }

                    // Add tool to panel
                    PanelManager_.addToolToPanel(panelConfig.id, metadata)
                    assignedToolIds.add(metadata.id)
                } catch (error) {
                    console.error(`[ToolControllerModern] Failed to add tool "${toolName}" to panel "${panelConfig.id}":`, error)
                }
            })
        })
    },

    /**
     * Assign remaining unassigned tools to compatible panels (fallback)
     * Respects tool metadata's preferredPosition when available
     *
     * @param {Array} registeredPanels - List of registered panels
     * @param {Map} toolConfigMap - Map of tool configurations
     * @param {Set} assignedToolIds - Set of already assigned tool IDs
     */
    assignFallbackTools: function (registeredPanels, toolConfigMap, assignedToolIds) {
        if (window.mmgisglobal?.debug) {
            console.log('[ToolControllerModern] Assigning fallback tools...')
        }

        toolConfigMap.forEach(({ config, metadata }) => {
            // Skip if already assigned
            if (assignedToolIds.has(metadata.id)) {
                return
            }

            // Skip tools that are explicitly turned off
            if (config.on === false) {
                return
            }

            // Skip tools that don't support modern layout
            if (metadata.modernLayoutSupport === false) {
                if (window.mmgisglobal?.debug) {
                    console.log(`[ToolControllerModern] Skipping "${metadata.name}" - no modern layout support`)
                }
                return
            }

            try {
                let targetPanelId = null

                // 1. Try preferred position from tool metadata
                if (metadata.preferredPosition) {
                    const preferredPanel = registeredPanels.find(p =>
                        p.config.position === metadata.preferredPosition &&
                        PanelManager_.isToolCompatible(p.id, metadata)
                    )

                    if (preferredPanel) {
                        targetPanelId = preferredPanel.id
                        if (window.mmgisglobal?.debug) {
                            console.log(`[ToolControllerModern] Assigning "${metadata.name}" to preferred panel "${preferredPanel.id}"`)
                        }
                    }
                }

                // 2. Try first compatible panel based on orientation
                if (!targetPanelId) {
                    const compatiblePanel = registeredPanels.find(p =>
                        PanelManager_.isToolCompatible(p.id, metadata)
                    )

                    if (compatiblePanel) {
                        targetPanelId = compatiblePanel.id
                        if (window.mmgisglobal?.debug) {
                            console.log(`[ToolControllerModern] Assigning "${metadata.name}" to compatible panel "${compatiblePanel.id}"`)
                        }
                    }
                }

                // 3. No compatible panel found
                if (!targetPanelId) {
                    console.warn(
                        `[ToolControllerModern] No compatible panel for "${metadata.name}"`,
                        `(requires: ${metadata.requiredOrientation}, compatible: ${metadata.compatiblePositions?.join(', ') || 'any'})`
                    )
                    return
                }

                // Add tool to panel
                PanelManager_.addToolToPanel(targetPanelId, metadata)
                assignedToolIds.add(metadata.id)

            } catch (error) {
                console.error(`[ToolControllerModern] Failed to assign "${metadata.name}":`, error)
            }
        })

        if (window.mmgisglobal?.debug) {
            console.log(`[ToolControllerModern] Assigned ${assignedToolIds.size} tools total`)
        }
    },

    /**
     * Load and assign tools to panels based on dashboard configuration
     * Tools are assigned in two passes:
     * 1. Explicit assignment via panel.tools arrays
     * 2. Fallback assignment for unassigned tools (if tool.on !== false)
     *
     * @param {Array} tools - Array of tool configurations from mission config
     */
    loadAndAssignTools: function (tools) {
        if (!tools || tools.length === 0) {
            console.warn('[ToolControllerModern] No tools configured')
            return
        }

        // Build tool configuration maps
        const { toolConfigMap, getToolData } = ToolControllerModern_.buildToolConfigMap(tools)
        const registeredPanels = PanelManager_.getAllPanelsByPriority()
        const assignedToolIds = new Set()

        // First pass: Assign tools based on panel.tools array
        ToolControllerModern_.assignExplicitTools(registeredPanels, getToolData, assignedToolIds)

        // Second pass: Assign remaining tools to compatible panels (fallback)
        ToolControllerModern_.assignFallbackTools(registeredPanels, toolConfigMap, assignedToolIds)
    },

    // ========================================================================
    // Tool Lifecycle Management (Loading, Instantiation, Cleanup)
    // ========================================================================

    /**
     * Load and instantiate a tool in a specific target container
     *
     * @param {Object} toolMetadata - Tool metadata object
     * @param {string} toolMetadata.id - Tool identifier (e.g., 'TitleTool')
     * @param {string} toolMetadata.name - Tool display name (e.g., 'Title')
     * @param {string} targetId - DOM element ID where tool should render
     * @returns {Object|null} Tool instance or null if failed
     */
    loadTool: function (toolMetadata, targetId) {
        // Validate inputs
        if (!toolMetadata || typeof toolMetadata !== 'object') {
            console.error('[ToolControllerModern] Invalid tool metadata:', toolMetadata)
            return null
        }

        if (!toolMetadata.id || typeof toolMetadata.id !== 'string') {
            console.error('[ToolControllerModern] Tool metadata missing required "id" field:', toolMetadata)
            return null
        }

        if (!targetId || typeof targetId !== 'string') {
            console.error('[ToolControllerModern] Missing or invalid targetId for tool:', toolMetadata.name)
            return null
        }

        // Verify DOM element exists (defense-in-depth with UserInterfaceModern_)
        const targetElement = document.getElementById(targetId)
        if (!targetElement) {
            console.error(
                `[ToolControllerModern] Target element "${targetId}" not found in DOM for tool "${toolMetadata.name}"`
            )
            return null
        }

        try {
            // Find the tool module in pre/tools.js exports
            const ToolClass = toolModules[toolMetadata.id]

            if (!ToolClass) {
                console.error(
                    `[ToolControllerModern] Tool module "${toolMetadata.id}" not found in toolModules.`,
                    'Available tools:',
                    Object.keys(toolModules)
                )
                return null
            }

            // Check if tool is already loaded in this container
            if (this._loadedTools.has(targetId)) {
                const existing = this._loadedTools.get(targetId)
                console.warn(
                    `[ToolControllerModern] Tool already loaded in container "${targetId}":`,
                    existing.toolName,
                    '- destroying before loading new tool'
                )
                this.destroyTool(targetId)
            }

            // Initialize tool if it has an initialize method
            if (typeof ToolClass.initialize === 'function') {
                ToolClass.initialize()
            }

            // Call make() to render the tool
            if (typeof ToolClass.make === 'function') {
                ToolClass.make(targetId)
            } else {
                console.warn(
                    `[ToolControllerModern] Tool "${toolMetadata.name}" does not have a make() method`
                )
            }

            // Track the loaded tool instance
            this._loadedTools.set(targetId, {
                toolInstance: ToolClass,
                toolName: toolMetadata.name,
                toolId: toolMetadata.id,
                targetId: targetId
            })

            if (window.mmgisglobal?.debug) {
                console.log(
                    `[ToolControllerModern] Loaded tool "${toolMetadata.name}" in container "${targetId}"`
                )
            }

            return ToolClass
        } catch (error) {
            console.error(
                `[ToolControllerModern] Failed to load tool "${toolMetadata.name}":`,
                error
            )
            return null
        }
    },

    /**
     * Destroy a tool instance in a specific container
     *
     * @param {string} targetId - DOM element ID of the tool container
     * @returns {boolean} True if destroyed successfully
     */
    destroyTool: function (targetId) {
        if (!this._loadedTools.has(targetId)) {
            return false
        }

        try {
            const { toolInstance, toolName } = this._loadedTools.get(targetId)

            // Call destroy() if available
            if (typeof toolInstance.destroy === 'function') {
                toolInstance.destroy()
            }

            // Remove from tracking
            this._loadedTools.delete(targetId)

            if (window.mmgisglobal?.debug) {
                console.log(
                    `[ToolControllerModern] Destroyed tool "${toolName}" from container "${targetId}"`
                )
            }

            return true
        } catch (error) {
            console.error(
                `[ToolControllerModern] Error destroying tool in container "${targetId}":`,
                error
            )
            return false
        }
    },

    /**
     * Destroy all loaded tools
     */
    destroyAllTools: function () {
        const targetIds = Array.from(this._loadedTools.keys())

        if (window.mmgisglobal?.debug) {
            console.log(`[ToolControllerModern] Destroying ${targetIds.length} loaded tools`)
        }

        targetIds.forEach(targetId => {
            this.destroyTool(targetId)
        })
    },

    /**
     * Get a loaded tool instance by target ID
     *
     * @param {string} targetId - DOM element ID of the tool container
     * @returns {Object|null} Tool data or null if not found
     */
    getTool: function (targetId) {
        return this._loadedTools.get(targetId) || null
    },

    /**
     * Check if a tool is loaded in a specific container
     *
     * @param {string} targetId - DOM element ID of the tool container
     * @returns {boolean} True if tool is loaded
     */
    isToolLoaded: function (targetId) {
        return this._loadedTools.has(targetId)
    },

    /**
     * Get all loaded tools
     *
     * @returns {Array} Array of loaded tool data objects
     */
    getAllLoadedTools: function () {
        return Array.from(this._loadedTools.values())
    },

    /**
     * Reload a tool in its container (destroy + load)
     *
     * @param {Object} toolMetadata - Tool metadata object
     * @param {string} targetId - DOM element ID where tool should render
     * @returns {Object|null} Tool instance or null if failed
     */
    reloadTool: function (toolMetadata, targetId) {
        this.destroyTool(targetId)
        return this.loadTool(toolMetadata, targetId)
    }
}

export default ToolControllerModern_
