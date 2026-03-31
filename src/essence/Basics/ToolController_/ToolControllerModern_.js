import PanelManager_ from '../PanelManager_/PanelManager_'
import { TOOL_ORIENTATION } from './types/tool'
import { PANEL_POSITION } from '../PanelManager_/types/layout'

const ToolControllerModern_ = {
    /**
     * Generate tool metadata from mission config tool definition
     * This is a mock implementation until proper tool metadata is available
     *
     * @param {Object} toolConfig - Tool configuration from mission config
     * @param {string} toolConfig.name - Tool name
     * @param {string} toolConfig.icon - Tool icon
     * @param {string} toolConfig.js - Tool JS module name
     * @returns {Object} Tool metadata object
     */
    generateToolMetadata: function (toolConfig) {
        // Default tool metadata based on common patterns
        const toolName = toolConfig.name || 'Unknown'
        const toolId = toolConfig.js || toolName.toLowerCase().replace(/\s+/g, '-')

        // Mock metadata - In the future, this should come from the tool's actual metadata
        return {
            id: toolId,
            name: toolName,
            // Most tools can adapt to any orientation for now
            // This should be refined based on actual tool requirements
            requiredOrientation: TOOL_ORIENTATION.ANY,
            icon: toolConfig.icon || 'cog',
            // Tools can be placed in any position by default
            compatiblePositions: undefined
        }
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
                console.warn(`[Modern Layout] Duplicate tool ID detected: ${toolMetadata.id}`)
            }
            toolConfigMap.set(toolMetadata.id, { config: toolConfig, metadata: toolMetadata })

            // Map name to ID for lookup
            if (toolNameToId.has(toolMetadata.name)) {
                console.warn(`[Modern Layout] Duplicate tool name detected: ${toolMetadata.name}`)
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
            const panelTools = panelConfig.tools || []

            panelTools.forEach(toolName => {
                const toolData = getToolData(toolName)

                if (!toolData) {
                    console.warn(`[Modern Layout] Tool "${toolName}" specified in panel "${panelConfig.id}" not found in tools config`)
                    return
                }

                try {
                    const { metadata } = toolData

                    // Check compatibility
                    if (!PanelManager_.isToolCompatible(panelConfig.id, metadata)) {
                        console.warn(`[Modern Layout] Tool "${metadata.name}" is not compatible with panel "${panelConfig.id}"`)
                        return
                    }

                    // Add tool to panel
                    PanelManager_.addToolToPanel(panelConfig.id, metadata)
                    assignedToolIds.add(metadata.id)

                    if (window.mmgisglobal?.debug) {
                        console.log(`[Modern Layout] Added tool "${metadata.name}" to panel "${panelConfig.id}"`)
                    }

                } catch (error) {
                    console.error(`[Modern Layout] Failed to add tool "${toolName}" to panel "${panelConfig.id}":`, error)
                }
            })
        })
    },

    /**
     * Assign remaining unassigned tools to compatible panels (fallback)
     * @param {Array} registeredPanels - List of registered panels
     * @param {Map} toolConfigMap - Map of tool configurations
     * @param {Set} assignedToolIds - Set of already assigned tool IDs
     */
    assignFallbackTools: function (registeredPanels, toolConfigMap, assignedToolIds) {
        const defaultPanel = registeredPanels.find(p => p.config.position === PANEL_POSITION.LEFT)
            || registeredPanels[0]

        if (!defaultPanel) {
            console.warn('[Modern Layout] No default panel found for fallback tool assignment')
            return
        }

        toolConfigMap.forEach(({ config, metadata }) => {
            // Skip if already assigned
            if (assignedToolIds.has(metadata.id)) {
                return
            }

            // Skip tools that are explicitly turned off
            if (config.on === false) {
                if (window.mmgisglobal?.debug) {
                    console.log(`[Modern Layout] Skipping tool "${metadata.name}" (on=false)`)
                }
                return
            }

            try {
                // Find a compatible panel
                let targetPanelId = defaultPanel.id
                if (!PanelManager_.isToolCompatible(targetPanelId, metadata)) {
                    const compatiblePanel = registeredPanels.find(p =>
                        PanelManager_.isToolCompatible(p.id, metadata)
                    )
                    if (compatiblePanel) {
                        targetPanelId = compatiblePanel.id
                    } else {
                        console.warn(`[Modern Layout] No compatible panel found for unassigned tool "${metadata.name}", skipping`)
                        return
                    }
                }

                PanelManager_.addToolToPanel(targetPanelId, metadata)
                assignedToolIds.add(metadata.id)

                if (window.mmgisglobal?.debug) {
                    console.log(`[Modern Layout] Added unassigned tool "${metadata.name}" to panel "${targetPanelId}" (fallback)`)
                }

            } catch (error) {
                console.error(`[Modern Layout] Failed to add unassigned tool "${metadata.name}":`, error)
            }
        })
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
            console.warn('[Modern Layout] No tools configured')
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

        if (window.mmgisglobal?.debug) {
            console.log(`[Modern Layout] Tool assignment complete. ${assignedToolIds.size} tools assigned`)
        }
    }
}

export default ToolControllerModern_
