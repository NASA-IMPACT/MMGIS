// Title Tool
// Displays a logo and title text from dashboard configuration
import $ from 'jquery'
import ReactDOM from 'react-dom'
import React from 'react'
import L_ from '../../Basics/Layers_/Layers_'
import TitleToolComponent from './TitleToolComponent'
import './TitleTool.css'

const TitleTool = {
    height: 60,
    width: 'full',
    MMGISInterface: null,
    targetId: null,
    made: false,
    titleText: '',
    iconClass: 'mdi mdi-earth mdi-24px',
    logoUrl: null,

    initialize: function () {

        // Get title from dashboard config
        this.titleText =
            L_.configData?.look?.pagename ||
            L_.configData?.msv?.mission ||
            window.mmgisglobal?.name ||
            'MMGIS'

        // Get logo from mission config (logoUrl)
        if (L_.configData?.look?.logourl) {
            this.logoUrl = L_.configData.look.logourl
        }

        // Get icon from tool variables if configured
        const toolVars = L_.getToolVars('title')

        if (toolVars && toolVars.icon) {
            this.iconClass = toolVars.icon
        }
    },

    make: function (targetId) {
        this.targetId = typeof targetId === 'string' ? targetId : 'toolPanel'
        this.MMGISInterface = new interfaceWithMMGIS()
        this.made = true
    },

    destroy: function () {
        this.MMGISInterface.separateFromMMGIS()
        this.targetId = null
        this.made = false
    },

    getUrlString: function () {
        return ''
    },
}

function interfaceWithMMGIS() {
    this.separateFromMMGIS = function () {
        separateFromMMGIS()
    }

    const container = document.getElementById(TitleTool.targetId)
    if (!container) {
        console.error(
            `TitleTool: container ${TitleTool.targetId} not found`
        )
        return
    }

    // Set panel background to transparent for title tool
    $(container).css('background', 'transparent')

    // Render React component
    ReactDOM.render(
        <TitleToolComponent
            titleText={TitleTool.titleText}
            logoUrl={TitleTool.logoUrl}
            iconClass={TitleTool.iconClass}
        />,
        container
    )

    function separateFromMMGIS() {
        const container = document.getElementById(TitleTool.targetId)
        if (container) {
            ReactDOM.unmountComponentAtNode(container)
            $(container).css('background', 'var(--mmgis-panel-bg)')
        }
    }
}

export default TitleTool
