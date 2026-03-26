import $ from 'jquery'
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
     */
    init: function (panels) {
        this.panels = panels
        this.render()
    },

    /**
     * Renders the layout into the #modern-content element
     */
    render: function () {
        console.log("panels", this.panels)
        const container = $('#modern-content')
        container.empty()

        // Create the main grid wrapper
        const gridWrapper = $('<div class="ui-modern-grid"></div>')

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

        // Render each region
        const renderRegion = (regionName, regionPanels) => {
            if (!regionPanels || regionPanels.length === 0) return null
            
            const regionDiv = $(`<div class="ui-region ui-region-${regionName}"></div>`)
            
            regionPanels.forEach(panel => {
                const panelDiv = $(`<div class="ui-panel" id="${panel.containerId}"></div>`)
                const body = $('<div class="ui-panel-body"></div>')

                if (panel.config.hasHeader) {
                    const header = $(`
                        <div class="ui-panel-header">
                            <h3 class="ui-panel-title">${panel.config.title || panel.id}</h3>
                            <div class="ui-panel-header-buttons">
                                <button class="ui-panel-btn ui-panel-btn-minimize" title="Minimize"><span class="mdi mdi-window-minimize"></span></button>
                                <button class="ui-panel-btn ui-panel-btn-maximize" title="Maximize"><span class="mdi mdi-window-maximize"></span></button>
                                <button class="ui-panel-btn ui-panel-btn-close" title="Close"><span class="mdi mdi-close"></span></button>
                            </div>
                        </div>
                    `)
                    panelDiv.append(header)
                }

                if (panel.config.capabilities && panel.config.capabilities.resizable) {
                    panelDiv.append(`<div class="ui-panel-drag-handle ui-panel-drag-handle-${regionName}"></div>`)
                }

                // Render placeholder cards for tools
                if (panel.tools && panel.tools.length > 0) {
                    panel.tools.forEach(toolName => {
                        const toolCard = $(`
                            <div class="ui-tool-card">
                                <span class="ui-tool-icon mdi mdi-view-dashboard"></span>
                                <span class="ui-tool-title">${toolName}</span>
                            </div>
                        `)
                        body.append(toolCard)
                    })
                } else {
                    body.append('<p class="ui-empty-text">No tools configured</p>')
                }

                panelDiv.append(body)
                regionDiv.append(panelDiv)
            })
            
            return regionDiv
        }

        // We will append regions. Grid layout will organize them.
        gridWrapper.append(renderRegion('top', layoutRegions.top))
        
        // A central map/globe container (wrapper for map/globe content)
        const centralArea = $('<div class="ui-region-center" id="ui-modern-center"></div>')
        gridWrapper.append(centralArea)

        gridWrapper.append(renderRegion('left', layoutRegions.left))
        gridWrapper.append(renderRegion('right', layoutRegions.right))
        gridWrapper.append(renderRegion('bottom', layoutRegions.bottom))

        container.append(gridWrapper)

        this.attachResizeEvents()
    },

    /**
     * Attaches mouse event listeners for panel resizing.
     */
    attachResizeEvents: function () {
        $(document).off('.uiModernResize')
        let isResizing = false
        let startX, startY
        let startWidth, startHeight
        let $currentPanel = null
        let currentConfig = null
        let currentRegion = null

        $('.ui-panel-drag-handle').on('mousedown', (e) => {
            e.preventDefault()
            isResizing = true

            const $handle = $(e.target)
            $currentPanel = $handle.closest('.ui-panel')

            if ($handle.hasClass('ui-panel-drag-handle-left')) currentRegion = 'left'
            else if ($handle.hasClass('ui-panel-drag-handle-right')) currentRegion = 'right'
            else if ($handle.hasClass('ui-panel-drag-handle-top')) currentRegion = 'top'
            else if ($handle.hasClass('ui-panel-drag-handle-bottom')) currentRegion = 'bottom'

            const panelId = $currentPanel.attr('id')
            const panelState = this.panels.find(p => p.containerId === panelId)
            currentConfig = panelState ? panelState.config : null

            startX = e.clientX
            startY = e.clientY
            startWidth = $currentPanel.outerWidth()
            startHeight = $currentPanel.outerHeight()

            $('body').css('user-select', 'none')
        })

        $(document).on('mousemove.uiModernResize', (e) => {
            if (!isResizing || !$currentPanel) return

            const caps = currentConfig?.capabilities || {}
            const minSize = caps.minSize !== undefined ? caps.minSize : 50
            const maxSize = caps.maxSize !== undefined ? caps.maxSize : 9999

            let newSize

            if (currentRegion === 'left') {
                const delta = e.clientX - startX
                newSize = Math.max(minSize, Math.min(startWidth + delta, maxSize))
                $currentPanel.css({ 'width': newSize + 'px', 'min-width': 'auto', 'max-width': 'none', 'flex': 'none' })
            } else if (currentRegion === 'right') {
                const delta = startX - e.clientX
                newSize = Math.max(minSize, Math.min(startWidth + delta, maxSize))
                $currentPanel.css({ 'width': newSize + 'px', 'min-width': 'auto', 'max-width': 'none', 'flex': 'none' })
            } else if (currentRegion === 'top') {
                const delta = e.clientY - startY
                newSize = Math.max(minSize, Math.min(startHeight + delta, maxSize))
                $currentPanel.css({ 'height': newSize + 'px', 'min-height': 'auto', 'max-height': 'none', 'flex': 'none' })
            } else if (currentRegion === 'bottom') {
                const delta = startY - e.clientY
                newSize = Math.max(minSize, Math.min(startHeight + delta, maxSize))
                $currentPanel.css({ 'height': newSize + 'px', 'min-height': 'auto', 'max-height': 'none', 'flex': 'none' })
            }
        })

        $(document).on('mouseup.uiModernResize', (e) => {
            if (isResizing) {
                isResizing = false
                $currentPanel = null
                currentConfig = null
                $('body').css('user-select', '')
            }
        })
    }
}

export default UserInterfaceModern_
