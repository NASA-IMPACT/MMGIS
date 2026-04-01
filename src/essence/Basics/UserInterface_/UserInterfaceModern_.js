import $ from 'jquery'
import PanelManager_ from '../PanelManager_/PanelManager_'
import './UserInterfaceModern_.css'

/**
 * Modern User Interface Module
 * Renders the layout defined by the USWDS/Horizon design system.
 * It is completely decoupled from the PanelManager state logic and only receives
 * the structured array of active panels.
 */
const UserInterfaceModern_ = {
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
            window.addEventListener('mmgis-panel-layout-changed', this.syncDOMState.bind(this))
            this._layoutEventListenerAdded = true
        }
    },

    /**
     * TODO: Use tool metadata to render actual tools and not just placeholders
     * Creates a single tool card for stacked layout
     * @param {string} toolName - Name of the tool
     * @returns {jQuery} Tool card element
     */
    createToolCard: function (toolName) {
        return $(`<div class="ui-tool-card ui-tool-card-stacked" data-tool="${toolName}"></div>`)
            .append('<span class="ui-tool-icon mdi mdi-view-dashboard"></span>')
            .append($('<span class="ui-tool-title"></span>').text(toolName))
    },

    /**
     * Renders a tabbed layout for panel tools
     * @param {Object} panel - Panel configuration object
     * @param {jQuery} body - Panel body element
     */
    renderTabbedLayout: function (panel, body) {
        body.addClass('ui-panel-body-tabbed')

        const tabBar = $('<div class="ui-panel-tabs"></div>')
        const tabContentArea = $('<div class="ui-panel-tab-content-area"></div>')

        panel.tools.forEach((toolName, idx) => {
            const isActive = idx === 0 ? 'active' : ''

            // Create tab
            const tab = $(`<div class="ui-panel-tab ${isActive}" data-tool="${toolName}"></div>`)
                .append('<span class="ui-tool-icon mdi mdi-view-dashboard"></span>')
                .append($('<span></span>').text(toolName))
            tabBar.append(tab)

            // Create tab content placeholder
            // TODO: Use actual tool metadata to render real content instead of placeholders
            const toolCard = $(`<div class="ui-tool-card ui-tool-tab-content ${isActive}" data-tool="${toolName}"></div>`)
            const cardContent = $('<div style="margin: auto; text-align: center;"></div>')
                .append('<span class="ui-tool-icon mdi mdi-view-dashboard" style="font-size: 2rem; display: block;"></span>')
                .append($('<span class="ui-tool-title"></span>').text(`${toolName} Content Placeholder`))
            toolCard.append(cardContent)
            tabContentArea.append(toolCard)
        })

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

        body.append(tabBar).append(tabContentArea)
    },

    /**
     * Renders a stacked layout for panel tools
     * @param {Object} panel - Panel configuration object
     * @param {jQuery} body - Panel body element
     */
    renderStackedLayout: function (panel, body) {
        panel.tools.forEach(toolName => {
            body.append(this.createToolCard(toolName))
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
                if (panel.tools && panel.tools.length > 0) {
                    panel.tools.forEach(toolName => {
                        const iconBtn = $(`<button class="ui-panel-icon-btn" title="${toolName}" data-tool="${toolName}"><span class="mdi mdi-view-dashboard"></span></button>`)
                        iconBtn.on('click', () => {
                            if (panel.state === 'focused' && panel.activeToolId === toolName) {
                                PanelManager_.setPanelState(panel.id, 'iconified')
                            } else {
                                PanelManager_.focusTool(panel.id, toolName)
                            }
                        })
                        iconsContainer.append(iconBtn)
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

        // Initialize active tools correctly
        this.panels.forEach(panel => {
            if (panel.activeToolId) {
                const $panel = $('#' + panel.containerId)
                $panel.find('.ui-panel-icon-btn').removeClass('active')
                $panel.find(`.ui-panel-icon-btn[data-tool="${panel.activeToolId}"]`).addClass('active')
                $panel.find('.ui-tool-card').removeClass('active')
                $panel.find(`.ui-tool-card[data-tool="${panel.activeToolId}"]`).addClass('active')
            }
        })

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

            if (panel.activeToolId) {
                // Update active state on icons
                $panel.find('.ui-panel-icon-btn').removeClass('active')
                $panel.find(`.ui-panel-icon-btn[data-tool="${panel.activeToolId}"]`).addClass('active')
                
                // Update active state on tool cards (especially for focused state and tabbed)
                $panel.find('.ui-tool-card').removeClass('active')
                $panel.find(`.ui-tool-card[data-tool="${panel.activeToolId}"]`).addClass('active')
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
