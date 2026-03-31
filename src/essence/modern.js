/*
  Modern Interface Initialization

  This file handles initialization for the "modern" interface mode.
  It parses the configuration, registers panels with the PanelManager, 
  and instantiates the layout via UserInterfaceModern.
*/

import $ from 'jquery'
import PanelManager_ from './Basics/PanelManager_/PanelManager_'
import UserInterfaceModern_ from './Basics/UserInterface_/UserInterfaceModern_'
import ToolControllerModern_ from './Basics/ToolController_/ToolControllerModern_'

import F_ from './Basics/Formulae_/Formulae_'
import L_ from './Basics/Layers_/Layers_'
import Viewer_ from './Basics/Viewer_/Viewer_'
import Map_ from './Basics/Map_/Map_'
import Globe_ from './Basics/Globe_/Globe_'

import CursorInfo from './Ancillary/CursorInfo'
import ContextMenu from './Ancillary/ContextMenu'
import Coordinates from './Ancillary/Coordinates'
import QueryURL from './Ancillary/QueryURL'
import TimeControl from './Basics/TimeControl_/TimeControl'

const modern = {
    configData: null,

    /**
     * Initialize the modern interface
     * @param {Object} config - Mission configuration data
     * @param {Array} missionsList - List of available missions
     * @param {boolean} swapping - Whether this is a mission swap
     */
    init: async function (config, missionsList, swapping) {
        // Save the config data
        modern.configData = config

        if (window.mmgisglobal?.debug) {
            console.log('[Modern Interface] Config:', config)
        }

        // Update URL to match mission
        var urlSplit = window.location.href.split('?')
        var url = urlSplit[0]

        if (
            urlSplit.length === 1 ||
            swapping ||
            (urlSplit[1] && urlSplit[1].split('=')[0] === 'forcelanding') ||
            (urlSplit[1] && urlSplit[1].split('=')[0] === '_preview')
        ) {
            // Use DB mission name for deeplinks (config._dbMissionName if available)
            const missionForUrl = config._dbMissionName || config.msv.mission
            url =
                window.location.href.split('?')[0] +
                '?mission=' +
                missionForUrl
            window.history.replaceState('', '', url)
            L_.url = window.location.href
        }

        // Try querying the urlSite for layers
        var urlOnLayers = null
        if (!swapping) urlOnLayers = QueryURL.queryURL()

        // Initialize layers map engine dependencies
        await L_.init(modern.configData, missionsList, urlOnLayers)

        F_.setRadius('major', L_.radius.major)
        F_.setRadius('minor', L_.radius.minor)

        if (!swapping) CursorInfo.init()
        if (!swapping) Globe_.init()
        if (!swapping) Viewer_.init()

        if (swapping) Map_.clear()

        // Update document title
        document.title =
            (window.mmgisglobal.name || 'MMGIS') + ' - ' + (config.msv?.mission || 'Modern Interface')

        // Clear the loading page and render the modern interface
        modern.render()
    },



    /**
     * Render the modern interface HTML
     */
    render: function () {
        // Remove loading page
        $('.LoadingPage').fadeOut(800, function () {
            $(this).remove()
        })

        // Clear main container
        $('#main-container').empty()

        // set blur to 0 in case it was left on from a previous mission
        $('#main-container').css('filter', 'blur(0px)')

        // Setup Map Container underneath
        const mapContainer = $('<div id="map"></div>')
        mapContainer.css({ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', 'z-index': 0 })
        $('#main-container').append(mapContainer)

        // Setup Panel Container
        const modernContent = $('<div id="modern-content"></div>')
        modernContent.css({ width: '100%', height: '100%', position: 'relative', 'z-index': 10, 'pointer-events': 'none' })
        $('#main-container').append(modernContent)

        // Fade in the main container
        $('#main-container').css('opacity', 0).animate({ opacity: 1 }, 800)

        // Parse config and register panels
        const panelsConfig = modern.configData.panelSettings?.panels || []

        const failedPanels = []
        panelsConfig.forEach(panelConfig => {
            try {
                // Register with the global PanelManager
                PanelManager_.registerPanel(panelConfig)
            } catch (error) {
                const panelId = panelConfig?.id || 'unknown'
                console.error(`[Modern Interface] Failed to register panel "${panelId}":`, error.message || error)
                failedPanels.push({ id: panelId, error: error.message || String(error) })
            }
        })

        if (failedPanels.length > 0 && window.mmgisglobal?.debug) {
            console.warn('[Modern Interface] Panel registration summary:', {
                total: panelsConfig.length,
                failed: failedPanels.length,
                failures: failedPanels
            })
        }

        // Load and assign tools to panels based on configuration
        const tools = modern.configData.tools || []
        ToolControllerModern_.loadAndAssignTools(tools)

        // Get all panels from PanelManager, already sorted by priority
        const activePanels = PanelManager_.getAllPanelsByPriority()

        const layoutStyle = modern.configData.panelSettings?.layoutStyle || 'overlay'

        // Initialize the User Interface with the sorted panels from PanelManager
        UserInterfaceModern_.init(activePanels, layoutStyle)

        // Initialize Map
        Map_.init(function() {
            Globe_.fina(Coordinates)
            L_.fina(
                Viewer_,
                Map_,
                Globe_,
                UserInterfaceModern_,
                Coordinates,
                TimeControl
            )
            Viewer_.fina(Map_)
            TimeControl.fina() // Disabled for modern layout; relies on classic DOM
        })
        // Coordinates.init()
        ContextMenu.init()

        //Make the time control
        TimeControl.init()

        if (window.mmgisglobal?.debug) {
            console.log('[Modern Interface] Initialized successfully')
            console.log('[Modern Interface] Config:', modern.configData)
            console.log('[Modern Interface] Active Panels:', activePanels)
        }
    },

    /**
     * Cleanup and prepare for mission swap
     */
    clear: function () {
        $('#modern-content').empty()
        $('#map').remove()

        if (window.mmgisglobal?.debug) {
            console.log('[Modern Interface] Cleared')
        }
    },
}

export default modern
