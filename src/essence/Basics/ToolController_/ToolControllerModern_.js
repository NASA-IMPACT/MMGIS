import PanelManager_ from '../PanelManager_/PanelManager_'
import { toolModules } from '../../../pre/tools'
import { generateToolMetadata } from './ToolMetadataUtils'
import { createLogger } from '../Logger_/Logger_'

const logger = createLogger('ToolControllerModern')

// --- Module-Level State ---
/**
 * Map of loaded tool instances: targetId -> { toolInstance, toolName, toolId, toolMetadata }
 */
const loadedTools = new Map()

/**
 * Reverse lookup: toolId -> targetId (populated only for currently-loaded tools)
 */
const toolIdToTargetId = new Map()

/**
 * Set of toolIds that are currently hidden via show/hide API or startHidden config
 */
const hiddenTools = new Set()

/**
 * Deferred tools: toolId -> { toolMetadata, targetId }
 * Tracks tools whose DOM container exists but whose make() has not been called
 * (either startUnloaded at init, or unloaded via unloadPlugin API)
 */
const deferredTools = new Map()

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

/**
 * Keep a tabbed panel's tab button in sync with its content card's hidden state.
 * No-op for stacked layouts, which have no .ui-panel-tabs sibling.
 * If the hidden tab was active, activates the next visible tab (and its content)
 * so the panel never settles on a clickable tab with nothing behind it, or no
 * active tab at all.
 *
 * @param {Element} panelEl - The tool's ancestor .ui-panel element
 * @param {string} toolId - Tool ID
 * @param {boolean} hidden - Whether the tab should be hidden
 */
const _syncTabVisibility = (panelEl, toolId, hidden) => {
    const tabBar = panelEl?.querySelector('.ui-panel-tabs')
    if (!tabBar) return

    const tabs = Array.from(tabBar.children)
    const tabEl = tabs.find(t => t.dataset.tool === toolId)
    if (!tabEl) return

    tabEl.classList.toggle('plugin-hidden', hidden)

    const hasActiveTab = tabs.some(t => !t.classList.contains('plugin-hidden') && t.classList.contains('active'))
    if (hasActiveTab) return

    // No visible tab is active (either this one just got hidden while active,
    // or this one was just shown and nothing else is active) — activate the
    // first visible tab and its matching content.
    tabs.forEach(t => t.classList.remove('active'))
    const nextTab = tabs.find(t => !t.classList.contains('plugin-hidden'))
    if (!nextTab) return
    nextTab.classList.add('active')
    const contentArea = panelEl.querySelector('.ui-panel-tab-content-area')
    if (!contentArea) return
    Array.from(contentArea.children).forEach(c => {
        c.classList.toggle('active', c.dataset.tool === nextTab.dataset.tool)
    })
}

/**
 * Keep a panel's iconified-state icon-tray button in sync with its content
 * card's hidden state, so a hidden/unloaded tool doesn't leave a clickable
 * icon pointing at nothing while the panel is iconified/focused.
 *
 * @param {Element} panelEl - The tool's ancestor .ui-panel element
 * @param {string} toolId - Tool ID
 * @param {boolean} hidden - Whether the icon button should be hidden
 */
const _syncIconTrayVisibility = (panelEl, toolId, hidden) => {
    const iconTray = panelEl?.querySelector('.ui-panel-icons')
    if (!iconTray) return
    const iconBtn = Array.from(iconTray.children).find(b => b.dataset.tool === toolId)
    iconBtn?.classList.toggle('plugin-hidden', hidden)
}

/**
 * Keep a tool's auxiliary visibility indicators (tabbed-panel tab button,
 * iconified-panel icon-tray button) in sync with its content card's hidden state.
 *
 * @param {string} targetId - DOM element ID of the tool's content container
 * @param {string} toolId - Tool ID
 * @param {boolean} hidden - Whether the tool's indicators should be hidden
 */
const _syncVisibilityIndicators = (targetId, toolId, hidden) => {
    const targetEl = document.getElementById(targetId)
    const panelEl = targetEl?.closest('.ui-panel')
    if (!panelEl) return
    _syncTabVisibility(panelEl, toolId, hidden)
    _syncIconTrayVisibility(panelEl, toolId, hidden)
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
                logger.warn(`Duplicate tool ID detected: ${toolMetadata.id} - skipping duplicate tool`)
                return
            }
            toolConfigMap.set(toolMetadata.id, { config: toolConfig, metadata: toolMetadata })

            // Map name to ID for lookup
            if (toolNameToId.has(toolMetadata.name)) {
                logger.warn(`Duplicate tool name detected: ${toolMetadata.name} - tool can only be referenced by ID`)
            } else {
                toolNameToId.set(toolMetadata.name, toolMetadata.id)
            }
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
                toolMetadata: toolMetadata,
                targetId: targetId
            })

            // Register reverse lookup (toolId -> targetId) for show/hide/unload by toolId
            toolIdToTargetId.set(toolMetadata.id, targetId)

            // Remove from deferred registry if it was queued there
            deferredTools.delete(toolMetadata.id)

            // Sync hidden state: if the container already has plugin-hidden class
            // (set by createToolCard when startHidden is true), track it
            const el = document.getElementById(targetId)
            if (el && el.classList.contains('plugin-hidden')) {
                hiddenTools.add(toolMetadata.id)
            }

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
            const { toolInstance, toolName, toolId } = loadedTools.get(targetId)

            // Call destroy() if available
            if (typeof toolInstance.destroy === 'function') {
                toolInstance.destroy()
            }

            // Remove from tracking
            loadedTools.delete(targetId)

            // Clean up reverse lookup and hidden state
            if (toolId) {
                toolIdToTargetId.delete(toolId)
                hiddenTools.delete(toolId)
            }

            logger.debug(`Destroyed tool "${toolName}" from container "${targetId}"`)

            return true
        } catch (error) {
            logger.error(`Error destroying tool in container "${targetId}":`, error)
            return false
        }
    },

    /**
     * Destroy all loaded tools and clear all plugin lifecycle state
     */
    destroyAllTools: function () {
        const targetIds = Array.from(loadedTools.keys())

        logger.debug(`Destroying ${targetIds.length} loaded tools`)

        targetIds.forEach(targetId => {
            this.destroyTool(targetId)
        })

        // Clear deferred registry (destroyTool already clears toolIdToTargetId and hiddenTools)
        deferredTools.clear()
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
    },

    // ========================================================================
    // Plugin Visibility & Lifecycle API (show/hide/load/unload by plugin ID)
    // ========================================================================

    /**
     * Register a tool as deferred — its DOM container exists but make() has not been called.
     * Called at init time for tools with startUnloaded:true, and internally by unloadPlugin.
     *
     * @param {Object} toolMetadata - Tool metadata object
     * @param {string} targetId - DOM element ID of the tool's container
     */
    registerDeferred: function (toolMetadata, targetId) {
        if (!toolMetadata || !targetId) return
        deferredTools.set(toolMetadata.id, { toolMetadata, targetId })
        // Hide the card so an empty container doesn't show background/shadow
        document.getElementById(targetId)?.classList.add('plugin-hidden')
        _syncVisibilityIndicators(targetId, toolMetadata.id, true)
        logger.debug(`Registered deferred tool "${toolMetadata.id}" in container "${targetId}"`)
    },

    /**
     * Show a plugin that was hidden via hidePlugin or startHidden config.
     * The plugin must already be loaded — its instance and state are preserved.
     *
     * @param {string} pluginId - Tool ID (e.g., 'TitleTool')
     * @returns {boolean} True if shown successfully, false if not found
     */
    showPlugin: function (pluginId) {
        const targetId = toolIdToTargetId.get(pluginId)
        if (!targetId) {
            logger.warn(`showPlugin: "${pluginId}" is not a loaded plugin`)
            return false
        }
        document.getElementById(targetId)?.classList.remove('plugin-hidden')
        hiddenTools.delete(pluginId)
        _syncVisibilityIndicators(targetId, pluginId, false)
        logger.debug(`Showed plugin "${pluginId}"`)
        return true
    },

    /**
     * Hide a plugin without destroying it. Its instance and internal state are preserved;
     * calling showPlugin later restores it exactly as left.
     *
     * @param {string} pluginId - Tool ID
     * @returns {boolean} True if hidden successfully, false if not found
     */
    hidePlugin: function (pluginId) {
        const targetId = toolIdToTargetId.get(pluginId)
        if (!targetId) {
            logger.warn(`hidePlugin: "${pluginId}" is not a loaded plugin`)
            return false
        }
        document.getElementById(targetId)?.classList.add('plugin-hidden')
        hiddenTools.add(pluginId)
        _syncVisibilityIndicators(targetId, pluginId, true)
        logger.debug(`Hid plugin "${pluginId}"`)
        return true
    },

    /**
     * Load a plugin that is currently deferred (startUnloaded at init, or previously unloaded).
     * Calls make() on the existing DOM container. The plugin starts visible after load.
     *
     * @param {string} pluginId - Tool ID
     * @returns {boolean} True if loaded (or already loaded), false if not found / load failed
     */
    loadPlugin: function (pluginId) {
        if (toolIdToTargetId.has(pluginId)) {
            logger.warn(`loadPlugin: "${pluginId}" is already loaded`)
            return true
        }
        const deferred = deferredTools.get(pluginId)
        if (!deferred) {
            logger.warn(`loadPlugin: "${pluginId}" not found in deferred registry`)
            return false
        }
        const instance = this.loadTool(deferred.toolMetadata, deferred.targetId)
        if (instance) {
            deferredTools.delete(pluginId)
            // Fresh load always starts visible — remove any leftover hidden class
            document.getElementById(deferred.targetId)?.classList.remove('plugin-hidden')
            hiddenTools.delete(pluginId)
            _syncVisibilityIndicators(deferred.targetId, pluginId, false)
            logger.debug(`Loaded deferred plugin "${pluginId}"`)
        }
        return !!instance
    },

    /**
     * Fully unload a plugin, releasing its instance and resources.
     * The DOM container is emptied but kept in place so loadPlugin can recreate it later.
     *
     * @param {string} pluginId - Tool ID
     * @returns {boolean} True if unloaded successfully, false if not found or already unloaded
     */
    unloadPlugin: function (pluginId) {
        const targetId = toolIdToTargetId.get(pluginId)
        if (!targetId) {
            logger.warn(`unloadPlugin: "${pluginId}" is not loaded`)
            return false
        }
        const toolData = loadedTools.get(targetId)
        if (!toolData) {
            logger.warn(`unloadPlugin: "${pluginId}" data not found`)
            return false
        }
        const savedMetadata = toolData.toolMetadata

        // Destroy instance and clean up tracking state
        this.destroyTool(targetId)

        // Clear the container content without removing the element itself;
        // hide it so the empty card doesn't show background/shadow
        const container = document.getElementById(targetId)
        if (container) {
            container.innerHTML = ''
            container.classList.add('plugin-hidden')
        }
        _syncVisibilityIndicators(targetId, pluginId, true)

        // Register for future reload
        deferredTools.set(pluginId, { toolMetadata: savedMetadata, targetId })
        logger.debug(`Unloaded plugin "${pluginId}", registered as deferred`)
        return true
    },

    /**
     * Check if a plugin is currently loaded (make() has been called and not yet destroyed)
     *
     * @param {string} pluginId - Tool ID
     * @returns {boolean}
     */
    isPluginLoaded: function (pluginId) {
        return toolIdToTargetId.has(pluginId)
    },

    /**
     * Check if a plugin is currently hidden via hidePlugin/startHidden (loaded but not visible).
     * Returns false for a plugin that was never loaded or is currently unloaded/deferred
     * (startUnloaded, or unloadPlugin) — those are also visually hidden but are reported
     * via isPluginLoaded()===false instead. Check both to fully reason about visibility.
     *
     * @param {string} pluginId - Tool ID
     * @returns {boolean}
     */
    isPluginHidden: function (pluginId) {
        return hiddenTools.has(pluginId)
    }
}

export default ToolControllerModern_
