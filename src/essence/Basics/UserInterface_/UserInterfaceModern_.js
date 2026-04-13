import $ from 'jquery'
import PanelManager_ from '../PanelManager_/PanelManager_'
import ToolControllerModern_ from '../ToolController_/ToolControllerModern_'
import './UserInterfaceModern_.css'

/**
 * Modern User Interface Module
 * Renders the layout defined by the USWDS/Horizon design system.
 * It is completely decoupled from the PanelManager state logic and only receives
 * the structured array of active panels.
 */
const UserInterfaceModern_ = {
    /**
     * Queue of tool loading functions to be called after DOM is fully rendered
     */
    _toolLoadQueue: [],

    /**
     * Bound event listener function for proper cleanup
     */
    _boundSyncDOMState: null,

    /**
     * Initializes the modern layout.
     * @param {Array} panels - Array of panel objects (parsed from config & PanelManager)
     * @param {string} layoutStyle - The layout style ('overlay' | 'compact')
     */
    init: function (panels, layoutStyle = 'overlay') {
        this.panels = panels
        this.layoutStyle = layoutStyle
        this.render()

        if (!this._layoutEventListenerAdded) {
            this._boundSyncDOMState = this.syncDOMState.bind(this)
            window.addEventListener('mmgis-panel-layout-changed', this._boundSyncDOMState)
            this._layoutEventListenerAdded = true
        }
    },

    /**
     * Destroy the modern UI and clean up all loaded tools
     */
    destroy: function () {
        ToolControllerModern_.destroyAllTools()
        this._toolLoadQueue = [] // Clear any pending loads
        if (this._layoutEventListenerAdded && this._boundSyncDOMState) {
            window.removeEventListener('mmgis-panel-layout-changed', this._boundSyncDOMState)
            this._boundSyncDOMState = null
            this._layoutEventListenerAdded = false
        }
        $('#modern-content').empty()
        this.panels = []
    },

    /**
     * Validates tool metadata has required fields
     * @param {Object} toolMetadata - Tool metadata object to validate
     * @throws {Error} If required fields are missing
     */
    validateToolMetadata: function (toolMetadata) {
        if (!toolMetadata) {
            throw new Error('[UserInterfaceModern] Tool metadata is null or undefined')
        }
        if (!toolMetadata.id) {
            throw new Error('[UserInterfaceModern] Tool metadata missing required field: id')
        }
        if (!toolMetadata.name) {
            throw new Error(`[UserInterfaceModern] Tool metadata missing required field: name (id: ${toolMetadata.id})`)
        }
    },

    /**
     * Validates and sanitizes tool icon class name
     * Automatically adds "mdi mdi-" prefix if user only provides icon name
     *
     * Examples:
     *   "layers" -> "mdi mdi-layers"
     *   "format-list-bulleted-type" -> "mdi mdi-format-list-bulleted-type"
     *   "mdi mdi-map" -> "mdi mdi-map" (already formatted)
     *   "fas fa-home" -> "fas fa-home" (other icon library)
     *
     * @param {string} iconClass - Icon class name or just icon name
     * @param {string} toolId - Tool ID for logging purposes
     * @returns {string} Valid icon class name
     */
    getValidIconClass: function (iconClass, toolId) {
        const defaultIcon = 'mdi mdi-view-dashboard'

        // Check if iconClass is a non-empty string
        if (!iconClass || typeof iconClass !== 'string' || iconClass.trim() === '') {
            if (window.mmgisglobal?.debug) {
                console.warn(`[UserInterfaceModern] Invalid icon class for tool "${toolId}", using default`)
            }
            return defaultIcon
        }

        const trimmed = iconClass.trim()

        // Basic validation: should contain only valid CSS class characters
        if (!/^[\w\s-]+$/.test(trimmed)) {
            console.warn(`[UserInterfaceModern] Invalid icon class format for tool "${toolId}": "${iconClass}", using default`)
            return defaultIcon
        }

        // If it's already a full MDI class (starts with "mdi mdi-"), pass it through
        if (trimmed.startsWith('mdi mdi-')) {
            return trimmed
        }

        // If it's another icon library (Font Awesome, etc.), pass it through
        if (/^(fas|far|fal|fab|fa|glyphicon)\s+/.test(trimmed)) {
            return trimmed
        }

        // If it's just the icon name (e.g., "layers", "format-list-bulleted-type"), add MDI prefix
        // Valid icon names: lowercase letters, numbers, and hyphens
        if (/^[a-z0-9-]+$/.test(trimmed)) {
            return `mdi mdi-${trimmed}`
        }

        // Handle legacy formats and fix them
        // "mdiLayers" -> "mdi mdi-layers"
        if (/^mdi[A-Z]/.test(trimmed)) {
            const iconName = trimmed
                .substring(3)
                .replace(/([A-Z])/g, '-$1')
                .toLowerCase()
                .replace(/^-/, '')
            console.warn(`[UserInterfaceModern] Auto-fixed icon for tool "${toolId}": "${iconClass}" -> "mdi mdi-${iconName}"`)
            return `mdi mdi-${iconName}`
        }

        // "mdi-layers" -> "mdi mdi-layers"
        if (/^mdi-[a-z0-9-]+$/.test(trimmed)) {
            console.warn(`[UserInterfaceModern] Auto-fixed icon for tool "${toolId}": "${iconClass}" -> "mdi ${trimmed}"`)
            return `mdi ${trimmed}`
        }

        // Anything else that doesn't match expected patterns - use default
        console.warn(`[UserInterfaceModern] Unknown icon format for tool "${toolId}": "${iconClass}", using default`)
        return defaultIcon
    },

    /**
     * Creates a single tool card for stacked layout (tool loading happens after DOM append)
     * @param {Object} toolMetadata - Tool metadata object
     * @param {string} panelId - Panel ID for generating unique tool container ID
     * @returns {Object} Object with toolCard element and load function
     * @throws {Error} If toolMetadata is invalid or panelId is missing
     */
    createToolCard: function (toolMetadata, panelId) {
        this.validateToolMetadata(toolMetadata)

        if (!panelId) {
            throw new Error('[UserInterfaceModern] panelId is required for createToolCard')
        }

        const toolId = toolMetadata.id
        const targetId = `${panelId}-tool-${toolId}`

        const toolCard = $(`<div class="ui-tool-card ui-tool-card-stacked" data-tool="${toolId}" id="${targetId}"></div>`)

        // Return card and a function to load the tool (called after append)
        // The load function checks if DOM element still exists before loading
        return {
            toolCard: toolCard,
            loadTool: () => {
                const $target = $(`#${targetId}`)
                if ($target.length === 0) {
                    console.warn(`[UserInterfaceModern] Target element "${targetId}" not found in DOM, skipping tool load`)
                    return
                }
                ToolControllerModern_.loadTool(toolMetadata, targetId)
            }
        }
    },

    /**
     * Renders a tabbed layout for panel tools
     * @param {Object} panel - Panel configuration object
     * @param {jQuery} body - Panel body element
     */
    renderTabbedLayout: function (panel, body) {
        if (!panel || !panel.id || !panel.containerId) {
            console.error('[UserInterfaceModern] Invalid panel object in renderTabbedLayout:', panel)
            return
        }

        body.addClass('ui-panel-body-tabbed')

        const tabBar = $('<div class="ui-panel-tabs"></div>')
        const tabContentArea = $('<div class="ui-panel-tab-content-area"></div>')

        // Get tool metadata from PanelManager
        let toolsMetadata = []
        try {
            toolsMetadata = PanelManager_.getToolsForPanel(panel.id) || []
        } catch (error) {
            console.error(`[UserInterfaceModern] Failed to get tools for panel "${panel.id}":`, error)
            return
        }

        toolsMetadata.forEach((toolMetadata, idx) => {
            try {
                this.validateToolMetadata(toolMetadata)

                const toolName = toolMetadata.name || toolMetadata.id
                const toolId = toolMetadata.id
                const isActive = idx === 0 ? 'active' : ''
                const targetId = `${panel.containerId}-tool-${toolId}`

                // Create tab
                const iconClass = this.getValidIconClass(toolMetadata.icon, toolId)
                const tab = $(`<div class="ui-panel-tab ${isActive}" data-tool="${toolId}"></div>`)
                    .append(`<span class="ui-tool-icon ${iconClass}"></span>`)
                    .append($('<span></span>').text(toolName))
                tabBar.append(tab)

                // Create tab content container
                const toolCard = $(`<div class="ui-tool-card ui-tool-tab-content ${isActive}" data-tool="${toolId}" id="${targetId}"></div>`)
                tabContentArea.append(toolCard)

                // Queue tool loading for after DOM is fully rendered
                // Check if DOM element still exists before loading
                this._toolLoadQueue.push(() => {
                    const $target = $(`#${targetId}`)
                    if ($target.length === 0) {
                        console.warn(`[UserInterfaceModern] Target element "${targetId}" not found in DOM, skipping tool load`)
                        return
                    }
                    ToolControllerModern_.loadTool(toolMetadata, targetId)
                })
            } catch (error) {
                console.error(`[UserInterfaceModern] Failed to render tool in tabbed layout (panel: ${panel.id}):`, error)
                // Skip this tool and continue with others
            }
        })

        body.append(tabBar).append(tabContentArea)

        // Bind tab click events
        tabBar.on('click', '.ui-panel-tab', function () {
            const $this = $(this)
            const targetTool = $this.data('tool')

            // Update active tabs
            tabBar.find('.ui-panel-tab').removeClass('active')
            $this.addClass('active')

            // Update active content
            tabContentArea.find('.ui-tool-tab-content').removeClass('active')
            tabContentArea.find(`.ui-tool-tab-content[data-tool="${targetTool}"]`).addClass('active')
        })
    },

    /**
     * Renders a stacked layout for panel tools
     * @param {Object} panel - Panel configuration object
     * @param {jQuery} body - Panel body element
     */
    renderStackedLayout: function (panel, body) {
        if (!panel || !panel.id || !panel.containerId) {
            console.error('[UserInterfaceModern] Invalid panel object in renderStackedLayout:', panel)
            return
        }

        // Get tool metadata from PanelManager
        let toolsMetadata = []
        try {
            toolsMetadata = PanelManager_.getToolsForPanel(panel.id) || []
        } catch (error) {
            console.error(`[UserInterfaceModern] Failed to get tools for panel "${panel.id}":`, error)
            return
        }

        toolsMetadata.forEach(toolMetadata => {
            try {
                const { toolCard, loadTool } = this.createToolCard(toolMetadata, panel.containerId)
                body.append(toolCard)
                // Queue tool loading for after DOM is fully rendered
                this._toolLoadQueue.push(loadTool)
            } catch (error) {
                console.error(`[UserInterfaceModern] Failed to render tool in stacked layout (panel: ${panel.id}):`, error)
                // Skip this tool and continue with others
            }
        })
    },

    /**
     * Algorithmically generates CSS Grid template based on panel priorities.
     * Higher priority (lower number) claims the overlapping corners.
     *
     * @param {Object} priorities - Map of positions to their priorities
     * @returns {Object} Grid template configuration with areas, columns, and rows
     */
    generateGridTemplate: function (priorities) {
        const { top, bottom, left, right } = priorities

        // Corner contest resolution based on priorities
        // Lower number = higher priority. In case of a tie, horizontal (top/bottom) wins
        const tl = top <= left ? 'top' : 'left'
        const tr = top <= right ? 'top' : 'right'
        const bl = bottom <= left ? 'bottom' : 'left'
        const br = bottom <= right ? 'bottom' : 'right'

        return {
            areas: `"${tl} top ${tr}" "left center right" "${bl} bottom ${br}"`,
            columns: 'auto 1fr auto',
            rows: 'auto 1fr auto'
        }
    },

    /**
     * Renders the layout into the #modern-content element
     */
    render: function () {
        const container = $('#modern-content')
        container.empty()

        // Clear the tool load queue (start fresh)
        this._toolLoadQueue = []

        // Create the main grid wrapper
        const gridWrapper = $('<div class="ui-modern-grid"></div>')
        if (this.layoutStyle === 'compact') {
            gridWrapper.addClass('ui-layout-compact')
        }

        // Group panels by position
        const layoutRegions = {
            top: [],
            left: [],
            right: [],
            bottom: []
        }

        this.panels.forEach(p => {
            const pos = p.config?.position
            if (layoutRegions[pos]) {
                layoutRegions[pos].push(p)
            }
        })

        // Determine layout based on panel priorities
        // this.panels is already sorted by priority (lowest number = highest priority)
        // We need to consider all four priorities to generate the correct grid layout

        const hasLeft = layoutRegions.left.length > 0
        const hasRight = layoutRegions.right.length > 0
        const hasTop = layoutRegions.top.length > 0
        const hasBottom = layoutRegions.bottom.length > 0

        // Find the priority for each type of panel (Infinity if not present)
        const priorities = {
            left: hasLeft ? layoutRegions.left[0].config.priority : Infinity,
            right: hasRight ? layoutRegions.right[0].config.priority : Infinity,
            top: hasTop ? layoutRegions.top[0].config.priority : Infinity,
            bottom: hasBottom ? layoutRegions.bottom[0].config.priority : Infinity
        }

        // Generate grid template algorithmically based on priorities
        const gridTemplate = this.generateGridTemplate(priorities)

        // Apply dynamic grid template
        gridWrapper.css({
            'grid-template-areas': gridTemplate.areas,
            'grid-template-columns': gridTemplate.columns,
            'grid-template-rows': gridTemplate.rows
        })

        // Render each region
        const renderRegion = (regionName, regionPanels) => {
            if (!regionPanels || regionPanels.length === 0) return null
            
            const regionDiv = $(`<div class="ui-region ui-region-${regionName}"></div>`)
            
            regionPanels.forEach(panel => {
                const panelDiv = $(`<div class="ui-panel" id="${panel.containerId}"></div>`)
                const contentWrapper = $('<div class="ui-panel-content"></div>')
                const body = $('<div class="ui-panel-body"></div>')

                const allowed = panel.config.stateConstraints?.allowedStates || []

                // Create the icons bar for iconified/focused state
                const iconsContainer = $('<div class="ui-panel-icons"></div>')
                const toolsMetadata = PanelManager_.getToolsForPanel(panel.id) || []

                if (toolsMetadata.length > 0) {
                    toolsMetadata.forEach(toolMetadata => {
                        try {
                            this.validateToolMetadata(toolMetadata)

                            const toolName = toolMetadata.name || toolMetadata.id
                            const toolId = toolMetadata.id
                            const iconClass = this.getValidIconClass(toolMetadata.icon, toolId)
                            const iconBtn = $(`<button class="ui-panel-icon-btn" title="${toolName}" data-tool="${toolId}"><span class="${iconClass}"></span></button>`)
                            iconBtn.on('click', () => {
                                if (panel.state === 'focused' && panel.activeToolId === toolId) {
                                    PanelManager_.setPanelState(panel.id, 'iconified')
                                } else {
                                    PanelManager_.focusTool(panel.id, toolId)
                                }
                            })
                            iconsContainer.append(iconBtn)
                        } catch (error) {
                            console.error(`[UserInterfaceModern] Failed to create icon button for tool in panel "${panel.id}":`, error)
                            // Skip this icon and continue with others
                        }
                    })
                }
                panelDiv.append(iconsContainer)

                if (panel.config.hasHeader) {
                    const header = $('<div class="ui-panel-header"></div>')
                    const title = $('<h3 class="ui-panel-title"></h3>').text(panel.config.title || panel.id)
                    const headerButtons = $('<div class="ui-panel-header-buttons"></div>')

                    if (allowed.includes('iconified') || allowed.includes('collapsed')) {
                        const minBtn = $('<button class="ui-panel-btn ui-panel-btn-minimize" title="Minimize"><span class="mdi mdi-window-minimize"></span></button>')
                        minBtn.on('click', () => {
                            const target = allowed.includes('iconified') ? 'iconified' : 'collapsed'
                            PanelManager_.setPanelState(panel.id, target)
                        })
                        headerButtons.append(minBtn)
                    }

                    if (allowed.includes('expanded')) {
                        const maxBtn = $('<button class="ui-panel-btn ui-panel-btn-maximize" title="Maximize"><span class="mdi mdi-window-maximize"></span></button>')
                        maxBtn.on('click', () => {
                            PanelManager_.setPanelState(panel.id, 'expanded')
                        })
                        headerButtons.append(maxBtn)
                    }

                    if (allowed.includes('collapsed')) {
                        const closeBtn = $('<button class="ui-panel-btn ui-panel-btn-close" title="Close"><span class="mdi mdi-close"></span></button>')
                        closeBtn.on('click', () => {
                            PanelManager_.setPanelState(panel.id, 'collapsed')
                        })
                        headerButtons.append(closeBtn)
                    }

                    header.append(title).append(headerButtons)
                    contentWrapper.append(header)
                }

                panelDiv.attr('data-panel-state', panel.state)

                if (panel.config.capabilities && panel.config.capabilities.resizable) {
                    panelDiv.append(`<div class="ui-panel-drag-handle ui-panel-drag-handle-${regionName}"></div>`)
                }

                // Render placeholders for tools based on layoutType
                if (panel.tools && panel.tools.length > 0) {
                    if (panel.config.layoutType === 'tabbed') {
                        this.renderTabbedLayout(panel, body)
                    } else {
                        this.renderStackedLayout(panel, body)
                    }
                } else {
                    body.append('<p class="ui-empty-text">No tools configured</p>')
                }

                contentWrapper.append(body)
                panelDiv.append(contentWrapper)
                regionDiv.append(panelDiv)
            })
            
            return regionDiv
        }

        // We will append regions. Grid layout will organize them.
        gridWrapper.append(renderRegion('top', layoutRegions.top))
        
        // A central map/globe container (wrapper for map/globe content)
        const centralArea = $('<div class="ui-region-center" id="ui-modern-center"></div>')
        gridWrapper.append(centralArea)

        if (this.layoutStyle === 'compact') {
            const mapEl = $('#map')
            if (mapEl.length) {
                centralArea.append(mapEl)
            }
        }

        gridWrapper.append(renderRegion('left', layoutRegions.left))
        gridWrapper.append(renderRegion('right', layoutRegions.right))
        gridWrapper.append(renderRegion('bottom', layoutRegions.bottom))

        container.append(gridWrapper)

        // Now that all DOM is in place, load all queued tools
        if (this._toolLoadQueue.length > 0) {
            if (window.mmgisglobal?.debug) {
                console.log(`[UserInterfaceModern] Loading ${this._toolLoadQueue.length} queued tools`)
            }
            const queue = this._toolLoadQueue;
            this._toolLoadQueue = [] // Clear the queue
            setTimeout(() => {
                queue.forEach(loadFn => {
                    try {
                        loadFn()
                    } catch (error) {
                        console.error('[UserInterfaceModern] Failed to load tool:', error)
                        // Continue loading other tools even if one fails
                    }
                })
            }, 0)
        }

        this.attachResizeEvents()

        // Ensure panels get their explicit dimensions applied on mount
        this.syncDOMState()
    },

    /**
     * Passively synchronize DOM based on event payload without destroying nodes.
     * @param {CustomEvent} e Custom layout changed event fired from PanelManager
     */
    syncDOMState: function (e) {
        if (e && e.detail && e.detail.panels) {
            this.panels = e.detail.panels
        }

        this.panels.forEach(panel => {
            const $panel = $('#' + panel.containerId)
            if ($panel.length === 0) return

            $panel.attr('data-panel-state', panel.state)

            if (panel.activeToolId && panel.state === 'focused') {
                // Update active state on icons
                $panel.find('.ui-panel-icon-btn').removeClass('active')
                $panel.find(`.ui-panel-icon-btn[data-tool="${panel.activeToolId}"]`).addClass('active')

                // Update active state on tool cards (especially for focused state and tabbed)
                $panel.find('.ui-tool-card').removeClass('active')
                $panel.find(`.ui-tool-card[data-tool="${panel.activeToolId}"]`).addClass('active')
            } else {
                // Remove active highlighting when not focused
                $panel.find('.ui-panel-icon-btn').removeClass('active')
            }

            if (panel.state === 'iconified') {
                $panel.css({ width: '', height: '', flex: 'none' })
            } else if (panel.state === 'expanded' || panel.state === 'focused') {
                let targetSize = panel.currentSize;

                if (!targetSize) {
                    targetSize = panel.config.dimensions?.expandedSize;
                }

                if (targetSize) {
                    const region = panel.config.position
                    if (region === 'left' || region === 'right') {
                        $panel.css({ width: targetSize + 'px', flex: 'none' })
                    } else if (region === 'top' || region === 'bottom') {
                        $panel.css({ height: targetSize + 'px', flex: 'none' })
                    }
                } else {
                    $panel.css({ width: '', height: '', flex: '' })
                }
            }
        })

        if (this.layoutStyle === 'compact') {
            window.dispatchEvent(new Event('resize'))
            setTimeout(() => {
                window.dispatchEvent(new Event('resize'))
            }, 300)
        }
    },

    /**
     * Attaches mouse event listeners for panel resizing.
     */
    attachResizeEvents: function () {
        // Clean up ALL previous event handlers
        $(document).off('.uiModernResize')
        $('.ui-panel-drag-handle').off('mousedown.uiModernResize')

        const self = this // Store reference to preserve context
        let isResizing = false
        let startX, startY
        let startWidth, startHeight
        let $currentPanel = null
        let currentConfig = null
        let currentRegion = null

        $('.ui-panel-drag-handle').on('mousedown.uiModernResize', function (e) {
            e.preventDefault()
            isResizing = true

            const $handle = $(e.target)
            $currentPanel = $handle.closest('.ui-panel')

            if ($handle.hasClass('ui-panel-drag-handle-left')) currentRegion = 'left'
            else if ($handle.hasClass('ui-panel-drag-handle-right')) currentRegion = 'right'
            else if ($handle.hasClass('ui-panel-drag-handle-top')) currentRegion = 'top'
            else if ($handle.hasClass('ui-panel-drag-handle-bottom')) currentRegion = 'bottom'

            const panelId = $currentPanel.attr('id')
            const panelState = self.panels.find(p => p.containerId === panelId)
            currentConfig = panelState ? panelState.config : null

            startX = e.clientX
            startY = e.clientY
            startWidth = $currentPanel.outerWidth()
            startHeight = $currentPanel.outerHeight()

            $('body').css('user-select', 'none').addClass('ui-is-dragging')
        })

        // Define resize strategies for each region to eliminate duplication
        const resizeStrategies = {
            left: {
                dimension: 'width',
                getDelta: (e) => e.clientX - startX,
                getStartSize: () => startWidth
            },
            right: {
                dimension: 'width',
                getDelta: (e) => startX - e.clientX,
                getStartSize: () => startWidth
            },
            top: {
                dimension: 'height',
                getDelta: (e) => e.clientY - startY,
                getStartSize: () => startHeight
            },
            bottom: {
                dimension: 'height',
                getDelta: (e) => startY - e.clientY,
                getStartSize: () => startHeight
            }
        }

        $(document).on('mousemove.uiModernResize', (e) => {
            if (!isResizing || !$currentPanel || !currentRegion) return

            const caps = currentConfig?.capabilities || {}
            const minSize = caps.minSize !== undefined ? caps.minSize : 50
            const maxSize = caps.maxSize !== undefined ? caps.maxSize : 9999

            const strategy = resizeStrategies[currentRegion]
            if (!strategy) return

            const delta = strategy.getDelta(e)
            const startSize = strategy.getStartSize()
            const newSize = Math.max(minSize, Math.min(startSize + delta, maxSize))

            const cssUpdates = {
                [strategy.dimension]: newSize + 'px',
                [`min-${strategy.dimension}`]: 'auto',
                [`max-${strategy.dimension}`]: 'none',
                'flex': 'none'
            }
            $currentPanel.css(cssUpdates)

            if (self.layoutStyle === 'compact') {
                window.dispatchEvent(new Event('resize'))
            }
        })

        $(document).on('mouseup.uiModernResize', () => {
            if (isResizing) {
                if ($currentPanel && currentConfig && currentRegion) {
                    const strategy = resizeStrategies[currentRegion]
                    if (strategy) {
                        const newSize = strategy.dimension === 'width' ? $currentPanel.outerWidth() : $currentPanel.outerHeight()
                        PanelManager_.resizePanel(currentConfig.id, newSize)
                    }
                }

                isResizing = false
                $currentPanel = null
                currentConfig = null
                currentRegion = null
                $('body').css('user-select', '').removeClass('ui-is-dragging')

                if (self.layoutStyle === 'compact') {
                    window.dispatchEvent(new Event('resize'))
                }
            }
        })
    }
}

export default UserInterfaceModern_
