import $ from 'jquery'
import PanelManager_ from '../PanelManager_/PanelManager_'
import ToolControllerModern_ from '../ToolController_/ToolControllerModern_'
import { getValidIconClass } from '../ToolController_/ToolMetadataUtils'
import { createLogger } from '../Logger_/Logger_'
import './UserInterfaceModern_.css'

const logger = createLogger('UserInterfaceModern')

const DEFAULT_MIN_PANEL_SIZE = 50;
const DEFAULT_MAX_PANEL_SIZE = 9999;

// --- Module-Level State ---
let panels = []
let layoutStyle = ''
let toolLoadQueue = []
let boundSyncDOMState = null
let layoutEventListenerAdded = false

// --- DOM Builder Helpers ---
const _createPanelIconTray = (panel) => {
    const iconsContainer = $('<div class="ui-panel-icons"></div>')
    const toolsMetadata = PanelManager_.getToolsForPanel(panel.id) || []

    toolsMetadata.forEach(toolMetadata => {
        const toolName = toolMetadata.name || toolMetadata.id
        const toolId = toolMetadata.id
        const iconClass = getValidIconClass(toolMetadata.icon, toolId)

        // Use safe jQuery methods to create elements and set attributes
        const iconSpan = $('<span></span>').addClass(iconClass)
        const iconBtn = $('<button></button>')
            .addClass('ui-panel-icon-btn')
            .attr('title', toolName) // jQuery escapes attribute values
            .attr('data-tool', toolId)
            .append(iconSpan)

        iconBtn.on('click', () => {
            if (panel.state === 'focused' && panel.activeToolId === toolId) {
                PanelManager_.setPanelState(panel.id, 'iconified')
            } else {
                PanelManager_.focusTool(panel.id, toolId)
            }
        })
        iconsContainer.append(iconBtn)
    })
    return iconsContainer
}

const _createPanelHeader = (panel) => {
    const allowed = panel.config.stateConstraints?.allowedStates || []
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
    return header
}

const _renderRegion = (regionName, regionPanels) => {
    if (!regionPanels || regionPanels.length === 0) return null
    
    const regionDiv = $(`<div class="ui-region ui-region-${regionName}"></div>`)
    
    regionPanels.forEach(panel => {
        const panelDiv = $('<div class="ui-panel"></div>').attr('id', panel.containerId)
        const contentWrapper = $('<div class="ui-panel-content"></div>')
        const body = $('<div class="ui-panel-body"></div>')

        // Icon Tray
        panelDiv.append(_createPanelIconTray(panel))

        // Header
        if (panel.config.hasHeader) {
            contentWrapper.append(_createPanelHeader(panel))
        }

        panelDiv.attr('data-panel-state', panel.state)

        if (panel.config.capabilities && panel.config.capabilities.resizable) {
            panelDiv.append($('<div></div>').addClass(`ui-panel-drag-handle ui-panel-drag-handle-${regionName}`))
        }

        // Tools rendering
        if (panel.tools && panel.tools.size > 0) {
            if (panel.config.layoutType === 'tabbed') {
                UserInterfaceModern_.renderTabbedLayout(panel, body)
            } else {
                UserInterfaceModern_.renderStackedLayout(panel, body)
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


/**
 * Modern User Interface Module
 */
const UserInterfaceModern_ = {
    /**
     * Initializes the modern layout.
     * @param {Array} panelsArr - Array of panel objects (parsed from config & PanelManager)
     * @param {string} style - The layout style ('overlay' | 'compact')
     */
    init: function (panelsArr, style = 'overlay') {
        panels = panelsArr
        layoutStyle = style
        this.render()

        if (!layoutEventListenerAdded) {
            boundSyncDOMState = this.syncDOMState.bind(this)
            window.addEventListener('mmgis-panel-layout-changed', boundSyncDOMState)
            layoutEventListenerAdded = true
        }
    },

    /**
     * Destroy the modern UI and clean up all loaded tools
     */
    destroy: function () {
        ToolControllerModern_.destroyAllTools()
        toolLoadQueue = [] // Clear any pending loads
        if (layoutEventListenerAdded && boundSyncDOMState) {
            window.removeEventListener('mmgis-panel-layout-changed', boundSyncDOMState)
            boundSyncDOMState = null
            layoutEventListenerAdded = false
        }
        $('#modern-content').empty()
        panels = []
    },

    /**
     * Creates a tool card container for either stacked or tabbed layout
     * Tool loading is deferred until after DOM is rendered
     *
     * @param {Object} toolMetadata - Tool metadata object
     * @param {string} panelId - Panel ID for generating unique tool container ID
     * @param {string} layoutType - Either 'stacked' or 'tabbed' (default: 'stacked')
     * @param {boolean} isActive - Whether this card should be active (default: false, used for tabbed layout)
     * @returns {Object} Object with toolCard element and loadTool function
     * @throws {Error} If toolMetadata is invalid or panelId is missing
     */
    createToolCard: function (toolMetadata, panelId, layoutType = 'stacked', isActive = false) {
        if (!panelId) {
            throw new Error('[UserInterfaceModern] panelId is required for createToolCard')
        }

        const toolId = toolMetadata.id
        const targetId = `${panelId}-tool-${toolId}`
        const layoutClass = layoutType === 'tabbed' ? 'ui-tool-tab-content' : 'ui-tool-card-stacked'

        const toolCard = $('<div></div>')
            .addClass('ui-tool-card')
            .addClass(layoutClass)
            .addClass(isActive ? 'active' : '')
            .attr('data-tool', toolId)
            .attr('id', targetId)

        // Return card and a function to load the tool (called after append)
        // The load function checks if DOM element still exists before loading
        return {
            toolCard: toolCard,
            loadTool: () => {

                const targetElement = document.getElementById(targetId)
                if (!targetElement) {
                    logger.warn(`Target element "${targetId}" not found in DOM, skipping tool load`)
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
            logger.error('Invalid panel object in renderTabbedLayout:', panel)
            return
        }

        body.addClass('ui-panel-body-tabbed')

        const tabBar = $('<div class="ui-panel-tabs"></div>')
        const tabContentArea = $('<div class="ui-panel-tab-content-area"></div>')

        const toolsMetadata = PanelManager_.getToolsForPanel(panel.id) || []

        toolsMetadata.forEach((toolMetadata, idx) => {
            const toolName = toolMetadata.name || toolMetadata.id
            const toolId = toolMetadata.id
            const isActive = idx === 0

            // Create tab using safe jQuery methods
            const iconClass = getValidIconClass(toolMetadata.icon, toolId)
            const iconSpan = $('<span></span>').addClass('ui-tool-icon').addClass(iconClass)
            const textSpan = $('<span></span>').text(toolName) // .text() is safe - auto-escapes

            const tab = $('<div></div>')
                .addClass('ui-panel-tab')
                .addClass(isActive ? 'active' : '')
                .attr('data-tool', toolId)
                .append(iconSpan)
                .append(textSpan)

            tabBar.append(tab)

            // Create tab content container and queue tool loading
            const { toolCard, loadTool } = this.createToolCard(toolMetadata, panel.containerId, 'tabbed', isActive)
            tabContentArea.append(toolCard)
            toolLoadQueue.push(loadTool)
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
            tabContentArea.find('.ui-tool-tab-content').filter((_, element) => {
                return $(element).data('tool') === targetTool
            }).addClass('active')
        })
    },

    /**
     * Renders a stacked layout for panel tools
     * @param {Object} panel - Panel configuration object
     * @param {jQuery} body - Panel body element
     */
    renderStackedLayout: function (panel, body) {
        if (!panel || !panel.id || !panel.containerId) {
            logger.error('Invalid panel object in renderStackedLayout:', panel)
            return
        }

        const toolsMetadata = PanelManager_.getToolsForPanel(panel.id) || []

        toolsMetadata.forEach(toolMetadata => {
            const { toolCard, loadTool } = this.createToolCard(toolMetadata, panel.containerId)
            body.append(toolCard)
            // Queue tool loading for after DOM is fully rendered
            toolLoadQueue.push(loadTool)
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
        toolLoadQueue = []

        // Create the main grid wrapper
        const gridWrapper = $('<div class="ui-modern-grid"></div>')
        if (layoutStyle === 'compact') {
            gridWrapper.addClass('ui-layout-compact')
        }

        // Group panels by position
        const layoutRegions = {
            top: [],
            left: [],
            right: [],
            bottom: []
        }

        panels.forEach(p => {
            const pos = p.config?.position
            if (layoutRegions[pos]) {
                layoutRegions[pos].push(p)
            }
        })

        logger.debug('Layout regions after grouping panels:', layoutRegions)

        // Determine layout based on panel priorities
        // panels is already sorted by priority (lowest number = highest priority)
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

        // We will append regions. Grid layout will organize them.
        gridWrapper.append(_renderRegion('top', layoutRegions.top))
        
        // A central map/globe container (wrapper for map/globe content)
        const centralArea = $('<div class="ui-region-center" id="ui-modern-center"></div>')
        gridWrapper.append(centralArea)

        if (layoutStyle === 'compact') {
            const mapEl = $('#map')
            if (mapEl.length) {
                centralArea.append(mapEl)
            }
        }

        gridWrapper.append(_renderRegion('left', layoutRegions.left))
        gridWrapper.append(_renderRegion('right', layoutRegions.right))
        gridWrapper.append(_renderRegion('bottom', layoutRegions.bottom))

        container.append(gridWrapper)

        // Now that all DOM is in place, load all queued tools
        if (toolLoadQueue.length > 0) {
            logger.debug(`Loading ${toolLoadQueue.length} queued tools`)
            const queue = toolLoadQueue;
            toolLoadQueue = [] // Clear the queue
            setTimeout(() => {
                queue.forEach(loadFn => {
                    try {
                        loadFn()
                    } catch (error) {
                        logger.error('Failed to load tool:', error)
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
            panels = e.detail.panels
        }

        panels.forEach(panel => {
            const $panel = $(document.getElementById(panel.containerId))
            if ($panel.length === 0) return

            $panel.attr('data-panel-state', panel.state)

            if (panel.activeToolId && panel.state === 'focused') {
                // Update active state on icons
                const activeToolId = panel.activeToolId
                $panel.find('.ui-panel-icon-btn').removeClass('active')
                $panel.find('.ui-panel-icon-btn').filter((_, element) => {
                    return $(element).data('tool') === activeToolId
                }).addClass('active')

                // Update active state on tool cards (especially for focused state and tabbed)
                $panel.find('.ui-tool-card').removeClass('active')
                $panel.find('.ui-tool-card').filter((_, element) => {
                    return $(element).data('tool') === activeToolId
                }).addClass('active')
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

        if (layoutStyle === 'compact') {
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
            const panelState = panels.find(p => p.containerId === panelId)
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

            const capabilities = currentConfig?.capabilities || {}
            const minSize = capabilities.minSize !== undefined ? capabilities.minSize : DEFAULT_MIN_PANEL_SIZE
            const maxSize = capabilities.maxSize !== undefined ? capabilities.maxSize : DEFAULT_MAX_PANEL_SIZE

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

            if (layoutStyle === 'compact') {
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

                if (layoutStyle === 'compact') {
                    window.dispatchEvent(new Event('resize'))
                }
            }
        })
    }
}

export default UserInterfaceModern_
