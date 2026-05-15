import PanelManager_ from '../PanelManager_/PanelManager_'
import { toolModules } from '../../../pre/tools'
import { generateToolMetadata } from './ToolMetadataUtils'
import { createLogger } from '../Logger_/Logger_'

const logger = createLogger('ToolControllerModern')

// --- Module-Level State ---
/**
 * Map of loaded tool instances: targetId -> { toolInstance, toolName, toolId }
 */
const loadedTools = new Map()

// --- Internal Helper Functions ---

/**
 * Finds a compatible panel for a tool, trying preferred position first
 * @param {Object} metadata Tool metadata
 * @param {Array} registeredPanels List of available panels
 * @returns {string|null} Panel ID if found, otherwise null
 */
const _findPanel = (metadata, registeredPanels) => {
    // Try preferred position first if specified
    if (metadata.preferredPosition) {
        const preferredPanel = registeredPanels.find(p =>
            p.config.position === metadata.preferredPosition &&
            PanelManager_.isToolCompatible(p.id, metadata)
        )

        if (preferredPanel) {
            logger.debug(`Assigning "${metadata.name}" to preferred panel "${preferredPanel.id}"`)
            return preferredPanel.id
        }
    }

    // Fall back to any compatible panel
    const compatiblePanel = registeredPanels.find(p =>
        PanelManager_.isToolCompatible(p.id, metadata)
    )

    if (compatiblePanel) {
        logger.debug(`Assigning "${metadata.name}" to compatible panel "${compatiblePanel.id}"`)
        return compatiblePanel.id
    }

    return null
}

const ToolControllerModern_ = {

    /**
     * Build tool configuration maps for efficient lookup
     * @param {Array} tools - Array of tool configurations
     * @returns {Object} Object containing toolConfigMap and getToolData helper
     */
    buildToolConfigMap: function (tools) {
        const toolConfigMap = new Map() // id -> { config, metadata }
        const toolNameToId = new Map() // name -> id

        tools.forEach(toolConfig => {
            const toolMetadata = generateToolMetadata(toolConfig)

            // Store by ID (primary key)
            if (toolConfigMap.has(toolMetadata.id)) {
                logger.warn(`Duplicate tool ID detected: ${toolMetadata.id}`)
            }
            toolConfigMap.set(toolMetadata.id, { config: toolConfig, metadata: toolMetadata })

            // Map name to ID for lookup
            if (toolNameToId.has(toolMetadata.name)) {
                logger.warn(`Duplicate tool name detected: ${toolMetadata.name}`)
            }
            toolNameToId.set(toolMetadata.name, toolMetadata.id)
        })

        // Helper function to get tool data by name or ID
        const getToolData = (nameOrId) => {
            const id = toolNameToId.get(nameOrId) || nameOrId
            return toolConfigMap.get(id)
        }

        return { toolConfigMap, getToolData }
    },

    /**
     * Assign tools explicitly defined in panel configurations
     *
     * @param {Array} registeredPanels - List of registered panels
     * @param {Function} getToolData - Function to get tool data by name or ID
     * @param {Set} assignedToolIds - Set to track assigned tool IDs
     */
    assignExplicitTools: function (registeredPanels, getToolData, assignedToolIds) {
        registeredPanels.forEach(panelState => {
            const panelConfig = panelState.config
            const panelTools = panelConfig.panelTools || []

            if (panelTools.length > 0) {
                logger.debug(`Explicit assignment for panel "${panelConfig.id}":`, panelTools)
            }

            panelTools.forEach(toolIdentifier => {
                const toolData = getToolData(toolIdentifier)

                if (!toolData) {
                    logger.warn(`Tool "${toolIdentifier}" specified in panel "${panelConfig.id}" not found in tools config`)
                    return
                }

                try {
                    const { metadata } = toolData

                    // Check compatibility
                    if (!PanelManager_.isToolCompatible(panelConfig.id, metadata)) {
                        logger.warn(`Tool "${metadata.name}" is not compatible with panel "${panelConfig.id}"`)
                        return
                    }

                    // Add tool to panel
                    PanelManager_.addToolToPanel(panelConfig.id, metadata)
                    assignedToolIds.add(metadata.id)
                } catch (error) {
                    logger.error(`Failed to add tool "${toolIdentifier}" to panel "${panelConfig.id}":`, error)
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
        logger.debug('Assigning fallback tools...')

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
                logger.debug(`Skipping "${metadata.name}" - no modern layout support`)
                return
            }

            try {
                const targetPanelId = _findPanel(metadata, registeredPanels)

                // No compatible panel found
                if (!targetPanelId) {
                    logger.warn(
                        `No compatible panel for "${metadata.name}"`,
                        `(requires: ${metadata.requiredOrientation}, compatible: ${metadata.compatiblePositions?.join(', ') || 'any'})`
                    )
                    return
                }

                // Add tool to panel
                PanelManager_.addToolToPanel(targetPanelId, metadata)
                assignedToolIds.add(metadata.id)

            } catch (error) {
                logger.error(`Failed to assign "${metadata.name}":`, error)
            }
        })

        logger.debug(`Assigned ${assignedToolIds.size} tools total`)
    },

    /**
     * Assign tools to panels based on dashboard configuration
     * Tools are assigned in two passes:
     * 1. Explicit assignment via panel.tools arrays
     * 2. Fallback assignment for unassigned tools (if tool.on !== false)
     *
     * @param {Array} tools - Array of tool configurations from mission config
     */
    assignToolsToPanels: function (tools) {
        if (!tools || tools.length === 0) {
            logger.warn('No tools configured')
            return
        }

        // Build tool configuration maps
        const { toolConfigMap, getToolData } = ToolControllerModern_.buildToolConfigMap(tools)
        const registeredPanels = PanelManager_.getAllPanelsByPriority()
        const assignedToolIds = new Set()

        logger.debug('Starting tool assignment...')
        logger.debug(`${tools.length} tools configured, ${registeredPanels.length} panels registered`)

        // First pass: Assign tools based on panel.toolNames array
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
            logger.error('Invalid tool metadata:', toolMetadata)
            return null
        }

        if (!toolMetadata.id || typeof toolMetadata.id !== 'string') {
            logger.error('Tool metadata missing required "id" field:', toolMetadata)
            return null
        }

        if (!targetId || typeof targetId !== 'string') {
            logger.error('Missing or invalid targetId for tool:', toolMetadata.name)
            return null
        }

        // Verify DOM element exists (defense-in-depth with UserInterfaceModern_)
        const targetElement = document.getElementById(targetId)
        if (!targetElement) {
            logger.error(`Target element "${targetId}" not found in DOM for tool "${toolMetadata.name}"`)
            return null
        }

        try {
            // Find the tool module in pre/tools.js exports
            const ToolClass = toolModules[toolMetadata.id]

            if (!ToolClass) {
                logger.error(
                    `Tool module "${toolMetadata.id}" not found in toolModules.`,
                    'Available tools:',
                    Object.keys(toolModules)
                )
                return null
            }

            // Check if tool is already loaded in this container
            if (loadedTools.has(targetId)) {
                const existing = loadedTools.get(targetId)
                logger.warn(
                    `Tool already loaded in container "${targetId}":`,
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
                logger.warn(`Tool "${toolMetadata.name}" does not have a make() method`)
            }

            // Track the loaded tool instance
            loadedTools.set(targetId, {
                toolInstance: ToolClass,
                toolName: toolMetadata.name,
                toolId: toolMetadata.id,
                targetId: targetId
            })

            logger.debug(`Loaded tool "${toolMetadata.name}" in container "${targetId}"`)

            return ToolClass
        } catch (error) {
            logger.error(`Failed to load tool "${toolMetadata.name}":`, error)
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
        if (!loadedTools.has(targetId)) {
            return false
        }

        try {
            const { toolInstance, toolName } = loadedTools.get(targetId)

            // Call destroy() if available
            if (typeof toolInstance.destroy === 'function') {
                toolInstance.destroy()
            }

            // Remove from tracking
            loadedTools.delete(targetId)

            logger.debug(`Destroyed tool "${toolName}" from container "${targetId}"`)

            return true
        } catch (error) {
            logger.error(`Error destroying tool in container "${targetId}":`, error)
            return false
        }
    },

    /**
     * Destroy all loaded tools
     */
    destroyAllTools: function () {
        const targetIds = Array.from(loadedTools.keys())

        logger.debug(`Destroying ${targetIds.length} loaded tools`)

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
        return loadedTools.get(targetId) || null
    },

    /**
     * Check if a tool is loaded in a specific container
     *
     * @param {string} targetId - DOM element ID of the tool container
     * @returns {boolean} True if tool is loaded
     */
    isToolLoaded: function (targetId) {
        return loadedTools.has(targetId)
    },

    /**
     * Get all loaded tools
     *
     * @returns {Array} Array of loaded tool data objects
     */
    getAllLoadedTools: function () {
        return Array.from(loadedTools.values())
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
