// Title Tool
// Displays a logo and title text from dashboard configuration
import $ from 'jquery'
import F_ from '../../Basics/Formulae_/Formulae_'
import L_ from '../../Basics/Layers_/Layers_'
import './TitleTool.css'

// Tool markup
const markup = [
    `<div id='titleTool'>`,
    `  <div class='titleTool-container'>`,
    `    <div class='titleTool-logo'>`,
    `      <!-- Logo will be inserted here if configured -->`,
    `    </div>`,
    `    <div class='titleTool-icon'>`,
    `      <i class='mdi mdi-earth mdi-24px'></i>`,
    `    </div>`,
    `    <div class='titleTool-text'>`,
    `      <span class='titleTool-title'></span>`,
    `    </div>`,
    `  </div>`,
    `</div>`,
].join('\n')

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
        this.targetId =
            typeof targetId === 'string'
                ? targetId
                : '__TitleTool_missing_targetId'
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

    const tools = $(
        TitleTool.targetId ? `#${TitleTool.targetId}` : '#toolPanel'
    )
    tools.css('background', 'transparent')
    tools.empty()

    // Add the markup to tools
    tools.html('<div style="height: 100%">' + markup + '</div>')

    // Set the title text
    $('#titleTool .titleTool-title').text(TitleTool.titleText)

    // Add logo if configured
    if (TitleTool.logoUrl) {
        const logoImg = $('<img>')
            .attr('src', TitleTool.logoUrl)
            .attr('alt', 'Logo')
            .addClass('titleTool-logo-img')
        $('#titleTool .titleTool-logo').empty().append(logoImg)
        $('#titleTool .titleTool-logo').show()
        // Hide the icon when logo is present
        $('#titleTool .titleTool-icon').hide()
    } else {
        // Show icon when no logo is configured
        $('#titleTool .titleTool-logo').hide()
        $('#titleTool .titleTool-icon').show()
    }

    // Update icon if configured
    if (TitleTool.iconClass) {
        $('#titleTool .titleTool-icon i')
            .attr('class', TitleTool.iconClass)
    }

    function separateFromMMGIS() {
        const tools = $(
            TitleTool.targetId ? `#${TitleTool.targetId}` : '#toolPanel'
        )
        tools.css('background', 'var(--color-k)')
        tools.empty()
    }
}

export default TitleTool
