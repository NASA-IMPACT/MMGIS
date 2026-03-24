import $ from 'jquery'
import F_ from '../Formulae_/Formulae_'
import L_ from '../Layers_/Layers_'
import ToolController_ from '../ToolController_/ToolController_'
import Login from '../../Ancillary/Login/Login'

import BottomBar from './BottomBar'
import LayerUpdatedControl from './LayerUpdatedControl'

import './UserInterfaceEnhanced_.css'

console.log('[UserInterfaceEnhanced] Loading enhanced layout UI')

var Viewer_ = null
var Map_ = null
var Globe_ = null

var UserInterface = {
    splitterSize: 0,
    topSize: 40,
    mainWidth: null,
    mainHeight: null,
    mapScreen: null,
    hasViewer: true,
    hasMap: true,
    hasGlobe: true,
    layerUpdatedControl: null,

    init: function () {
        console.log('[UserInterfaceEnhanced] Initializing enhanced layout UI')

        // Create top bar
        this.createTopBar()

        // Create main container for map
        this.createMainContainer()

        // Login
        Login.init()

        // Bottom bar (for misc controls)
        this.createBottomBar()

        console.log('[UserInterfaceEnhanced] Enhanced layout UI initialized')
    },

    createTopBar: function () {
        const topBarMarkup = [
            "<div id='topBar'>",
                "<div id='topBarLeft' class='hideScrollbar'>",
                    "<div id='topBarMain'>",
                        "<div id='topBarTitle'>",
                            `<div id='topBarTitleName' tabindex='200'>`,
                                window.mmgisglobal.name,
                            "</div>",
                        "</div>",
                    "</div>",
                    "<div id='topBarSecondary'>",
                        "<div class='mainDescription' title='Go to active item'>",
                        "</div>",
                        "<div class='mainInfo' title='Go to featured item'>",
                        "</div>",
                    "</div>",
                "</div>",
                "<div id='topBarRight'>",
                    "<div class='Search'>",
                    "</div>",
                "</div>",
            "</div>"
        ].join('\n')

        $('#main-container').append(topBarMarkup)

        $('#topBarLeft').on('wheel', function (e) {
            e.preventDefault()
            this.scrollLeft += e.originalEvent.deltaY
        })
    },

    createMainContainer: function () {
        // Main container for the map (takes full viewport, panels will overlay)
        const mainContainer = $('<div>')
            .attr('id', 'enhancedLayoutContainer')
            .css({
                position: 'absolute',
                top: this.topSize + 'px',
                left: '0px',
                width: '100%',
                height: 'calc(100% - ' + this.topSize + 'px)',
                overflow: 'hidden'
            })
        $('#main-container').append(mainContainer)

        // Map screen takes full container
        this.mapScreen = $('<div>')
            .attr('id', 'mapScreen')
            .css({
                position: 'absolute',
                width: '100%',
                height: '100%',
                top: '0px',
                left: '0px'
            })
        mainContainer.append(this.mapScreen)

        // Map div inside map screen
        const mapDiv = $('<div>')
            .attr('id', 'map')
            .css({
                position: 'absolute',
                'background-color': 'var(--color-a-5)',
                width: '100%',
                height: '100%'
            })
        this.mapScreen.append(mapDiv)

        // Viewer div (initially hidden, can be toggled)
        const viewerDiv = $('<div>')
            .attr('id', 'viewer')
            .css({
                position: 'absolute',
                'background-color': 'var(--color-a-5)',
                width: '0px',
                height: '100%',
                display: 'none'
            })
        mainContainer.append(viewerDiv)

        // Globe div (initially hidden)
        const globeDiv = $('<div>')
            .attr('id', 'globe')
            .css({
                position: 'absolute',
                'background-color': 'var(--color-a-5)',
                width: '0px',
                height: '100%',
                display: 'none'
            })
        mainContainer.append(globeDiv)

        this.mainWidth = mainContainer.width()
        this.mainHeight = mainContainer.height()

        console.log('[UserInterfaceEnhanced] Main container created:', {
            width: this.mainWidth,
            height: this.mainHeight
        })
    },

    createBottomBar: function () {
        this.barBottom = $('<div>').attr('id', 'barBottom').css({
            position: 'absolute',
            width: '40px',
            bottom: '0px',
            left: '0px',
            display: 'flex',
            'flex-flow': 'column',
            'z-index': '1005',
        })
        $('#main-container').append(this.barBottom)

        BottomBar.init('barBottom', this)
    },

    fina: function (l_, viewer_, map_, globe_) {
        console.log('[UserInterfaceEnhanced] Finalizing enhanced layout')

        // Initialize ToolController (which will use PanelManager for enhanced layout)
        ToolController_.init(l_.tools)
        ToolController_.fina(this)

        // Store references
        Viewer_ = viewer_
        Map_ = map_
        this.Map_ = map_
        Globe_ = globe_
        this.hasViewer = l_.hasViewer
        this.hasGlobe = l_.hasGlobe

        // Home button
        $('#topBarTitleName').on('click', L_.home)

        console.log('[UserInterfaceEnhanced] Enhanced layout finalized')
    },

    // Utility methods needed by other components
    getToolContentContainerId: function () {
        return 'toolPanel'
    },

    hide: function () {
        // Hide interface elements if needed
    },

    show: function () {
        // Show interface elements if needed
    },

    getPanelPercents: function () {
        // For enhanced layout, map always takes 100% (panels overlay)
        return {
            viewer: 0,
            map: 100,
            globe: 0
        }
    },

    setPanelPercents: function (viewer, map, globe) {
        // In enhanced layout, panels don't affect map size (they overlay)
        console.log('[UserInterfaceEnhanced] Panel percents not applicable in enhanced layout')
    },

    resizeToolPanel: function (width) {
        // Handled by PanelManager
    },

    minimalist: function (bool) {
        // Minimalist mode handling if needed
    },

    // Layer update control methods
    updateLayerUpdateButton: function (type) {
        if (this.layerUpdatedControl) {
            this.layerUpdatedControl.update(type)
        }
    },

    removeLayerUpdateButton: function () {
        if (this.layerUpdatedControl) {
            this.layerUpdatedControl.remove()
        }
    }
}

export default UserInterface
