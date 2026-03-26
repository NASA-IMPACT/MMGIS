/*
  Modern Layout Initialization

  This file handles initialization for the "modern" dashboard mode.
  It parses the configuration, registers panels with the PanelManager, 
  and instantiates the layout via UserInterfaceModern.
*/

import $ from 'jquery'
import PanelManager_ from './Basics/PanelManager_/PanelManager_'
import UserInterfaceModern_ from './Basics/UserInterface_/UserInterfaceModern_'

const modern = {
    configData: null,

    /**
     * Initialize the modern layout
     * @param {Object} config - Mission configuration data
     * @param {Array} missionsList - List of available missions
     * @param {boolean} swapping - Whether this is a mission swap
     */
    init: async function (config, missionsList, swapping) {
        // Save the config data
        modern.configData = config
        console.log("config", config)

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
        }

        // Update document title
        document.title =
            (window.mmgisglobal.name || 'MMGIS') + ' - ' + (config.msv?.mission || 'Modern Layout')

        // Clear the loading page and render the modern layout
        modern.render()
    },

    /**
     * Render the modern layout HTML
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

        // Setup Panel Container
        const modernContent = $('<div id="modern-content"></div>')
        modernContent.css({ width: '100%', height: '100%' })
        $('#main-container').append(modernContent)

        // Fade in the main container
        $('#main-container').css('opacity', 0).animate({ opacity: 1 }, 800)

        // Parse config and register panels
        const panelsConfig = modern.configData.panelSettings?.panels || []

        panelsConfig.forEach(panelConfig => {
            try {
                // Register with the global PanelManager
                PanelManager_.registerPanel(panelConfig)

                // In a full implementation, addToolToPanel would be used here
                // to register individual tools with the panel
            } catch (e) {
                console.warn('[Modern Layout] Panel registration warning:', e)
            }
        })

        // Get all panels from PanelManager, already sorted by priority
        const activePanels = PanelManager_.getAllPanelsByPriority()

        // Initialize the User Interface with the sorted panels from PanelManager
        UserInterfaceModern_.init(activePanels)

        console.log('[Modern Layout] Initialized successfully')
        console.log('[Modern Layout] Config:', modern.configData)
    },

    /**
     * Cleanup and prepare for mission swap
     */
    clear: function () {
        $('#modern-content').empty()
        console.log('[Modern Layout] Cleared')
    },
}

export default modern
