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
                const header = $(`<div class="ui-panel-header"><h3>${panel.config.title || panel.id}</h3></div>`)
                const body = $('<div class="ui-panel-body"></div>')

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

                panelDiv.append(header)
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
    }
}

export default UserInterfaceModern_
