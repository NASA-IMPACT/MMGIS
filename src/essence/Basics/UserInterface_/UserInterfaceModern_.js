import $ from 'jquery'
import PanelManager_ from '../PanelManager_/PanelManager_'
import { mmgisAPI, mmgisAPI_ } from '../../mmgisAPI/mmgisAPI'
import ToolControllerModern_ from '../ToolController_/ToolControllerModern_'
import { getValidIconClass } from '../ToolController_/ToolMetadataUtils'
import { createLogger } from '../Logger_/Logger_'
import { PANEL_STATE, FLOAT_POSITIONS } from '../PanelManager_/types/layout'
import './UserInterfaceModern_.css'

const logger = createLogger('UserInterfaceModern')

const DEFAULT_MIN_PANEL_SIZE = 50;
const DEFAULT_MAX_PANEL_SIZE = 9999;

// --- Module-Level State ---
let panels = []
let layoutStyle = ''
let toolLoadQueue = []
let cleanupLayoutListener = null
let _resizeObserver = null

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
            // Apply hidden class at init for tools configured with startHidden/startUnloaded,
            // mirrors the 'plugin-hidden' class applied to the content card.
            .addClass(toolMetadata.startHidden || toolMetadata.startUnloaded ? 'plugin-hidden' : '')
            .attr('title', toolName) // jQuery escapes attribute values
            .attr('data-tool', toolId)
            .append(iconSpan)

        iconBtn.on('click', () => {
            if (panel.state === PANEL_STATE.FOCUSED && panel.activeToolId === toolId) {
                _panelCommand('panels:setState', panel.id, { state: PANEL_STATE.ICONIFIED })
            } else {
                PanelManager_.focusTool(panel.id, toolId)
            }
        })
        iconsContainer.append(iconBtn)
    })
    return iconsContainer
}

/**
 * Issue a panel command over the bus and surface a refusal. Every control goes
 * through here, so a command the constraints reject leaves a diagnosable trace
 * instead of a dead click.
 */
const _panelCommand = (name, panelId, extra = {}) => {
    mmgisAPI.request(name, { panelId, ...extra })
        .then((result) => {
            if (!result?.ok) {
                logger.warn(`Panel command "${name}" on "${panelId}" refused: ${result?.reason}`)
            }
        })
        .catch((err) => {
            logger.warn(`Panel command "${name}" on "${panelId}" failed:`, err)
        })
}

const _createPanelHeader = (panel) => {
    const header = $('<div class="ui-panel-header"></div>')
    const title = $('<h3 class="ui-panel-title"></h3>').text(panel.config.title || panel.id)
    const headerButtons = $('<div class="ui-panel-header-buttons"></div>')

    const addButton = (className, titleText, icon, onClick) => {
        const btn = $(`<button class="ui-panel-btn ${className}" title="${titleText}"><span class="mdi ${icon}"></span></button>`)
        btn.on('click', onClick)
        headerButtons.append(btn)
    }

    // Minimize prefers iconified — it keeps the tool icons reachable — and falls
    // back to collapsing outright when the panel has no iconified state.
    const minimizeTarget = PanelManager_.canSetState(panel.id, PANEL_STATE.ICONIFIED)
        ? PANEL_STATE.ICONIFIED
        : PanelManager_.canSetState(panel.id, PANEL_STATE.COLLAPSED)
            ? PANEL_STATE.COLLAPSED
            : null

    if (minimizeTarget) {
        addButton('ui-panel-btn-minimize', 'Minimize', 'mdi-window-minimize', () =>
            _panelCommand('panels:setState', panel.id, { state: minimizeTarget })
        )
    }

    if (PanelManager_.canSetState(panel.id, PANEL_STATE.EXPANDED)) {
        addButton('ui-panel-btn-maximize', 'Maximize', 'mdi-window-maximize', () =>
            _panelCommand('panels:setState', panel.id, { state: PANEL_STATE.EXPANDED })
        )
    }

    if (PanelManager_.canSetState(panel.id, PANEL_STATE.COLLAPSED)) {
        addButton('ui-panel-btn-close', 'Close', 'mdi-close', () =>
            _panelCommand('panels:hide', panel.id)
        )
    }

    header.append(title).append(headerButtons)
    return header
}

// Converts a dimension value to a CSS string.
// Numbers are treated as px; strings are passed through as-is (e.g. "40%", "50vh").
const _toCssValue = (v) => (typeof v === 'number' ? v + 'px' : v)

const _renderFloatRegions = (floatPanels) => {
    if (!floatPanels || floatPanels.length === 0) return null

    const fragment = $('<div class="ui-float-regions"></div>')

    // Group panels by their float position (validator enforces at most one per position)
    const byPosition = {}
    floatPanels.forEach(panel => {
        const pos = panel.config.position
        if (!byPosition[pos]) byPosition[pos] = []
        byPosition[pos].push(panel)
    })

    Object.entries(byPosition).forEach(([position, positionPanels]) => {
        const suffix = position.replace('float-', '')
        const zone = $(`<div class="ui-float-zone ui-float-zone-${suffix}"></div>`)

        positionPanels.forEach(panel => {
            const toolsMetadata = PanelManager_.getToolsForPanel(panel.id) || []
            if (toolsMetadata.length === 0) return

            // One panel card per float zone — all tools stack inside it
            const panelDiv = $('<div class="ui-panel ui-float-panel"></div>')
                .attr('id', panel.containerId)
                .attr('data-panel-state', panel.state)

            // Strips every layout-drawn surface from the panel and its tool cards,
            // leaving the tools' own boxes sitting directly on the map
            if (panel.config.transparent) {
                panelDiv.addClass('ui-panel-transparent')
            }

            const dims = panel.config.dimensions || {}

            // Width constraints go on the panel container
            const panelCss = {}
            if (dims.defaultWidth)  panelCss['width']     = _toCssValue(dims.defaultWidth)
            if (dims.minWidth)      panelCss['min-width'] = _toCssValue(dims.minWidth)
            if (dims.maxWidth)      panelCss['max-width'] = _toCssValue(dims.maxWidth)
            if (Object.keys(panelCss).length) panelDiv.css(panelCss)

            if (panel.config.hasHeader) {
                panelDiv.append(_createPanelHeader(panel))
            }

            // Body holds all tool cards stacked vertically with gaps
            const body = $('<div class="ui-float-panel-body"></div>')

            // Height constraints go on the body so overflow-y: auto can trigger correctly.
            // Applying max-height only to the panel won't constrain the flex body's actual height,
            // so the body scroll never fires; setting it on the body directly fixes this.
            const bodyCss = {}
            if (dims.defaultHeight) bodyCss['height']     = _toCssValue(dims.defaultHeight)
            if (dims.minHeight)     bodyCss['min-height'] = _toCssValue(dims.minHeight)
            if (dims.maxHeight)     bodyCss['max-height'] = _toCssValue(dims.maxHeight)
            if (Object.keys(bodyCss).length) body.css(bodyCss)
            toolsMetadata.forEach(toolMetadata => {
                const { toolCard, loadTool, targetId } = UserInterfaceModern_.createToolCard(toolMetadata, panel.containerId)
                toolCard.addClass('active')
                body.append(toolCard)
                if (toolMetadata.startUnloaded) {
                    toolLoadQueue.push(() => ToolControllerModern_.registerDeferred(toolMetadata, targetId))
                } else {
                    toolLoadQueue.push(loadTool)
                }
            })

            panelDiv.append(body)
            zone.append(panelDiv)
        })

        fragment.append(zone)
    })

    return fragment
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

        // Pinned region, above the body so its tools hold their place while
        // everything below them scrolls. Null unless the panel pins anything.
        const pinnedRegion = UserInterfaceModern_.renderPinnedRegion(panel)
        if (pinnedRegion) {
            contentWrapper.append(pinnedRegion)
        }

        // Tools rendering
        const scrollingTools = PanelManager_.getScrollingToolsForPanel(panel.id)
        if (scrollingTools.length > 0) {
            if (panel.config.layoutType === 'tabbed') {
                UserInterfaceModern_.renderTabbedLayout(panel, body)
            } else {
                UserInterfaceModern_.renderStackedLayout(panel, body)
            }
        } else if (!pinnedRegion) {
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
     * @param {string} theme - The theme identifier (e.g. 'default', 'disasters')
     */
    init: function (panelsArr, style = 'overlay', theme = 'default') {
        panels = panelsArr
        layoutStyle = style

        try {
            require(`../../../../dist/${theme}.css`)
            logger.log(`Loaded theme CSS for ${theme}`)
        } catch (e) {
            logger.warn(`Failed to load theme CSS for ${theme}. Loading default.`, e)
            try {
                require(`../../../../dist/default.css`)
            } catch (err) {
                logger.error(`Failed to load default theme CSS.`, err)
            }
        }

        this.render()

        // Expose the controller and manager instances so the panels/plugins
        // bus providers can read live state without a direct import.
        mmgisAPI_._pluginController = ToolControllerModern_
        mmgisAPI_._panelManager = PanelManager_

        if (!cleanupLayoutListener) {
            cleanupLayoutListener = mmgisAPI.on('panels:changed', this.syncDOMState.bind(this))
        }

        // Set up ResizeObserver to dispatch resize events when the center map area changes size
        if (_resizeObserver) {
            _resizeObserver.disconnect()
        }
        _resizeObserver = new ResizeObserver(() => {
            window.dispatchEvent(new Event('resize'))
        })
        const centerElement = document.getElementById('ui-modern-center')
        if (centerElement) {
            _resizeObserver.observe(centerElement)
        }
    },

    /**
     * Destroy the modern UI and clean up all loaded tools
     */
    destroy: function () {
        ToolControllerModern_.destroyAllTools()
        toolLoadQueue = [] // Clear any pending loads
        if (cleanupLayoutListener) {
            cleanupLayoutListener()
            cleanupLayoutListener = null
        }
        if (_resizeObserver) {
            _resizeObserver.disconnect()
            _resizeObserver = null
        }
        $('#modern-content').empty()
        panels = []
        mmgisAPI_._pluginController = null
        mmgisAPI_._panelManager = null
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
            // Apply hidden class at init for tools configured with startHidden:true
            .addClass(toolMetadata.startHidden ? 'plugin-hidden' : '')
            .attr('data-tool', toolId)
            .attr('id', targetId)

        // Return card, a function to load the tool (called after append), and targetId
        // so callers can register deferred tools without re-deriving the container ID.
        // The load function checks if DOM element still exists before loading.
        return {
            toolCard: toolCard,
            targetId: targetId,
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

        const toolsMetadata = PanelManager_.getScrollingToolsForPanel(panel.id) || []

        // Pick the first tool that isn't starting hidden/unloaded to be the
        // active tab, so we don't land on a tab whose content is invisible.
        // Falls back to idx 0 if every tool starts hidden/unloaded.
        const firstVisibleIdx = toolsMetadata.findIndex(t => !t.startHidden && !t.startUnloaded)
        const activeIdx = firstVisibleIdx === -1 ? 0 : firstVisibleIdx

        toolsMetadata.forEach((toolMetadata, idx) => {
            const toolName = toolMetadata.name || toolMetadata.id
            const toolId = toolMetadata.id
            const isActive = idx === activeIdx
            // Mirrors the 'plugin-hidden' class applied to the content card below,
            // so a tool that starts hidden/unloaded doesn't leave a clickable tab
            // pointing at invisible content.
            const startsHidden = !!(toolMetadata.startHidden || toolMetadata.startUnloaded)

            // Create tab using safe jQuery methods
            const iconClass = getValidIconClass(toolMetadata.icon, toolId)
            const iconSpan = $('<span></span>').addClass('ui-tool-icon').addClass(iconClass)
            const textSpan = $('<span></span>').text(toolName) // .text() is safe - auto-escapes

            const tab = $('<div></div>')
                .addClass('ui-panel-tab')
                .addClass(isActive ? 'active' : '')
                .addClass(startsHidden ? 'plugin-hidden' : '')
                .attr('data-tool', toolId)
                .append(iconSpan)
                .append(textSpan)

            tabBar.append(tab)

            // Create tab content container and queue tool loading (or deferral)
            const { toolCard, loadTool, targetId } = this.createToolCard(toolMetadata, panel.containerId, 'tabbed', isActive)
            tabContentArea.append(toolCard)
            if (toolMetadata.startUnloaded) {
                toolLoadQueue.push(() => ToolControllerModern_.registerDeferred(toolMetadata, targetId))
            } else {
                toolLoadQueue.push(loadTool)
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

        const toolsMetadata = PanelManager_.getScrollingToolsForPanel(panel.id) || []

        toolsMetadata.forEach(toolMetadata => {
            const { toolCard, loadTool, targetId } = this.createToolCard(toolMetadata, panel.containerId)
            body.append(toolCard)
            // Queue tool loading (or deferred registration) for after DOM is fully rendered
            if (toolMetadata.startUnloaded) {
                toolLoadQueue.push(() => ToolControllerModern_.registerDeferred(toolMetadata, targetId))
            } else {
                toolLoadQueue.push(loadTool)
            }
        })
    },

    /**
     * Renders a panel's pinned region — the tools that sit above the panel body
     * and don't scroll with it. Cards are built exactly as stacked body cards
     * are, so a tool behaves the same wherever it is placed.
     *
     * @param {Object} panel - Panel configuration object
     * @returns {jQuery|null} The pinned region, or null if the panel pins nothing
     */
    renderPinnedRegion: function (panel) {
        if (!panel || !panel.id || !panel.containerId) {
            logger.error('Invalid panel object in renderPinnedRegion:', panel)
            return null
        }

        const toolsMetadata = PanelManager_.getPinnedToolsForPanel(panel.id) || []
        if (toolsMetadata.length === 0) return null

        const pinnedRegion = $('<div class="ui-panel-pinned"></div>')

        toolsMetadata.forEach(toolMetadata => {
            const { toolCard, loadTool, targetId } = this.createToolCard(toolMetadata, panel.containerId)
            pinnedRegion.append(toolCard)
            // Queue tool loading (or deferred registration) for after DOM is fully rendered
            if (toolMetadata.startUnloaded) {
                toolLoadQueue.push(() => ToolControllerModern_.registerDeferred(toolMetadata, targetId))
            } else {
                toolLoadQueue.push(loadTool)
            }
        })

        return pinnedRegion
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
        // Defensive: a re-render destroys the DOM the lifecycle registries point to,
        // so any already-loaded/deferred tools must be cleared or they'd reference
        // stale elements (isPluginLoaded would lie, loadTool's "already loaded" guard
        // would try to destroy a tool whose DOM no longer exists).
        ToolControllerModern_.destroyAllTools()

        const container = $('#modern-content')
        container.empty()

        // Clear the tool load queue (start fresh)
        toolLoadQueue = []

        // Create the main grid wrapper
        const gridWrapper = $('<div class="ui-modern-grid"></div>')
        if (layoutStyle === 'compact') {
            gridWrapper.addClass('ui-layout-compact')
        }

        // Group panels by position — float positions go into a separate bucket
        const layoutRegions = {
            top: [],
            left: [],
            right: [],
            bottom: []
        }
        const floatPanels = []

        panels.forEach(p => {
            const pos = p.config?.position
            if (FLOAT_POSITIONS.has(pos)) {
                floatPanels.push(p)
            } else if (layoutRegions[pos]) {
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

        const floatRegions = _renderFloatRegions(floatPanels)
        if (floatRegions) {
            centralArea.append(floatRegions)
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
            setTimeout(() => ToolControllerModern_.runLoadQueue(queue), 0)
        }

        this.attachResizeEvents()

        // Ensure panels get their explicit dimensions applied on mount
        this.syncDOMState()
    },

    /**
     * Passively synchronize DOM based on event payload without destroying nodes.
     * @param {Object} e Layout changed event payload
     */
    syncDOMState: function (e) {
        panels.forEach(panel => {
            const isFloatingPanel = FLOAT_POSITIONS.has(panel.config?.position)

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

            // Float panels are sized via dimensions.defaultWidth/defaultHeight applied
            // once at render time (see _renderFloatRegions) — the edge-panel
            // expandedSize/iconifiedSize logic below doesn't apply and would clobber them.
            if (isFloatingPanel) {
                // no-op
            } else if (panel.state === 'iconified') {
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
export { _createPanelHeader, _createPanelIconTray, _renderRegion }
