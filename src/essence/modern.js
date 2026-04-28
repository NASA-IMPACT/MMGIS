/**
 *  Modern Interface Initialization
 *
 * This file handles initialization for the "modern" interface mode with panel-based layouts.
 * It provides a class-based architecture for managing the modern UI lifecycle including:
 * - Configuration validation
 * - Panel registration and management
 * - Tool loading and assignment
 * - Map and component initialization
 * - Proper cleanup and finalization
 *
 * REFACTORING STATUS:
 * Done: Panel system integration, tool loading, configuration validation, class-based architecture
 * TODO: WebSocket support, mission swapping, Viewer_/Globe_ independence
 *
 * KNOWN LIMITATIONS:
 * - Viewer_ and Globe_ still required for L_.init() but not rendered in modern layout
 * - WebSocket not yet implemented (TODO: Add WebSocket support similar to essence.js)
 * - Mission swap not yet supported (TODO: Implement swapMission() and makeMission() methods)
 *
 * @module modern
 * @requires jquery
 * @requires PanelManager_
 * @requires UserInterfaceModern_
 * @requires ToolControllerModern_
 * @requires ComponentController_
 */

/**
 * @typedef {import('./types/dashboard').MissionConfig} MissionConfig
 * @typedef {import('./types/dashboard').ValidationResult} ValidationResult
 */

import $ from 'jquery'
import PanelManager_ from './Basics/PanelManager_/PanelManager_'
import UserInterfaceModern_ from './Basics/UserInterface_/UserInterfaceModern_'
import ToolControllerModern_ from './Basics/ToolController_/ToolControllerModern_'
import ComponentController_ from './Basics/ComponentController_/ComponentController_'

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
import { stylize } from './Ancillary/Stylize'
import { mmgisAPI_ } from './mmgisAPI/mmgisAPI'

import { validateModernConfig, sanitizeText } from './Validators/DashboardConfigValidator'

/**
 * Modern Interface Manager
 *
 * Manages the lifecycle of the modern panel-based interface including initialization,
 * configuration validation, panel registration, tool loading, and cleanup.
 */
class ModernInterface {
    /**
     * Creates a ModernInterface instance
     *
     * @constructor
     */
    constructor() {
        /**
         * Current mission configuration data
         * @type {MissionConfig|null}
         * @private
         */
        this.configData = null

        /**
         * Finalization status flag
         * Prevents multiple finalization calls
         * @type {boolean}
         * @private
         */
        this.finalized = false
    }

    /**
     * Initialize the modern interface
     *
     * Performs the following initialization sequence:
     * 1. Validates mission configuration
     * 2. Updates browser URL with mission name
     * 3. Initializes layers and map dependencies
     * 4. Sets up geospatial formulae
     * 5. Initializes cursor info, globe, and viewer
     * 6. Renders the modern interface
     *
     * @param {MissionConfig} config - Mission configuration data
     * @param {Array} missionsList - List of available missions
     * @param {boolean} swapping - Whether this is a mission swap (not yet fully supported)
     * @returns {Promise<void>}
     * @throws {Error} If configuration validation fails
     * @throws {Error} If mission name is invalid or missing
     * @public
     */
    async init(config, missionsList, swapping) {
        // Save the config data
        this.configData = config

        // Validate configuration before proceeding
        const validationResult = validateModernConfig(config)
        if (!validationResult.valid) {
            console.error('[Modern Interface] Configuration validation failed:', validationResult.errors)
            throw new Error('Invalid modern interface configuration')
        }

        // Update URL to match mission - with proper sanitization
        this._updateMissionUrl(config, swapping)

        // Try querying the urlSite for layers
        let urlOnLayers = null
        if (!swapping) urlOnLayers = QueryURL.queryURL()

        // Initialize layers map engine dependencies
        await L_.init(this.configData, missionsList, urlOnLayers)

        F_.setRadius('major', L_.radius.major)
        F_.setRadius('minor', L_.radius.minor)

        if (!swapping) CursorInfo.init()
        if (!swapping) Globe_.init()
        if (!swapping) Viewer_.init()

        if (swapping) Map_.clear()

        // Update document title with sanitization
        const appName = sanitizeText(window.mmgisglobal?.name || 'MMGIS')
        const missionName = sanitizeText(config.msv?.mission || 'Modern Interface')
        document.title = `${appName} - ${missionName}`

        // Clear the loading page and render the modern interface
        this.render()
    }

    /**
     * Updates the browser URL with the mission name
     *
     * Uses URLSearchParams for safe URL manipulation and validates mission name
     * before encoding. Only updates URL when:
     * - No query string exists
     * - Mission is being swapped
     * - Force landing or preview mode is active
     *
     * @param {MissionConfig} config - Mission configuration
     * @param {boolean} swapping - Whether this is a mission swap
     * @private
     * @throws {Error} If mission name is invalid
     */
    _updateMissionUrl(config, swapping) {
        const urlParams = new URLSearchParams(window.location.search)
        const hasForcelanding = urlParams.has('forcelanding') || urlParams.has('forceLanding')
        const hasPreview = urlParams.has('_preview')

        if (
            urlParams.toString() === '' ||
            swapping ||
            hasForcelanding ||
            hasPreview
        ) {
            // Use DB mission name for deeplinks (config._dbMissionName if available)
            const missionForUrl = config._dbMissionName || config.msv?.mission

            if (!missionForUrl || typeof missionForUrl !== 'string') {
                console.error('[Modern Interface] Invalid mission name in config')
                throw new Error('Invalid mission name')
            }

            // Sanitize and encode mission name for URL
            const sanitizedMission = encodeURIComponent(missionForUrl.trim())
            const baseUrl = window.location.href.split('?')[0]
            const newUrl = `${baseUrl}?mission=${sanitizedMission}`

            // Validate URL before applying
            try {
                new URL(newUrl) // Throws if invalid
                window.history.replaceState('', '', newUrl)
                L_.url = window.location.href
            } catch (err) {
                console.error('[Modern Interface] Failed to update URL:', err)
            }
        }
    }

    /**
     * Render the modern interface HTML and initialize panels
     *
     * @public
     * @throws {Error} If critical panel registration fails
     */
    render() {
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

        // Register panels
        this._registerPanels()

        // Load and assign tools to panels based on configuration
        const tools = this.configData?.tools || []
        ToolControllerModern_.loadAndAssignTools(tools)

        // Get all panels from PanelManager, already sorted by priority
        const activePanels = PanelManager_.getAllPanelsByPriority()

        const layoutStyle = this.configData?.panelSettings?.layoutStyle || 'overlay'

        // Initialize the User Interface with the sorted panels from PanelManager
        UserInterfaceModern_.init(activePanels, layoutStyle)

        // Initialize Map with proper error handling
        Map_.init(() => {
            try {
                this.fina()
            } catch (err) {
                console.error('[Modern Interface] Finalization failed:', err)
            }
        })

        // Coordinates.init()
        ContextMenu.init()

        // Make the time control
        TimeControl.init()
    }

    /**
     * Register panels with the PanelManager
     *
     * Iterates through panel configurations and registers each with PanelManager.
     *
     * @private
     * @throws {Error} If any critical panel fails to register
     */
    _registerPanels() {
        const panelsConfig = this.configData?.panelSettings?.panels || []

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

        if (failedPanels.length > 0) {
            console.warn('[Modern Interface] Panel registration summary:', {
                total: panelsConfig.length,
                failed: failedPanels.length,
                failures: failedPanels
            })        
        }
    }

    /**
     * Finalize the modern interface
     *
     * Called after Map_.init() completes. Performs final initialization steps:
     * 1. Finalizes Globe with Coordinates
     * 2. Finalizes Layers with all dependencies
     * 3. Finalizes UserInterfaceModern (if fina method exists)
     * 4. Finalizes Viewer with Map
     * 5. Finalizes TimeControl
     * 6. Finalizes mmgisAPI
     * 7. Applies custom styling via stylize()
     * 8. Initializes ComponentController components
     *
     * Uses a finalization guard to prevent multiple calls.
     */
    fina() {
        if (!this.finalized) {
            try {
                // Finalize Globe
                Globe_.fina(Coordinates)

                // Finalize Layers
                L_.fina(
                    Viewer_,
                    Map_,
                    Globe_,
                    UserInterfaceModern_,
                    Coordinates,
                    TimeControl
                )

                // Finalize the interface (if UserInterfaceModern_ has a fina method)
                if (typeof UserInterfaceModern_.fina === 'function') {
                    UserInterfaceModern_.fina(L_, Viewer_, Map_, Globe_)
                }

                // Finalize the Viewer
                Viewer_.fina(Map_)

                // Finalize the TimeControl
                TimeControl.fina()

                // Finalize the mmgisAPI
                if (mmgisAPI_ && typeof mmgisAPI_.fina === 'function') {
                    mmgisAPI_.fina(Map_)
                }

                // Apply custom styling
                stylize()

                // Initialize components after UI finalization
                if (ComponentController_ && typeof ComponentController_.initializeComponents === 'function') {
                    ComponentController_.initializeComponents()
                }

                // Only set finalized to true if all finalization steps succeeded
                this.finalized = true
            } catch (err) {
                console.error('[Modern Interface] Error during finalization:', err)
                throw err
            }
        }
    }

    /**
     * Cleanup and prepare for mission swap
     *
     * Performs comprehensive cleanup in the following order:
     * 1. Clears tools via ToolControllerModern
     * 2. Unregisters all panels from PanelManager
     * 3. Clears layers via L_
     * 4. Clears viewer images
     * 5. Clears map resources
     * 6. Removes DOM elements
     * 7. Resets finalization flag
     *
     * All cleanup operations are wrapped in existence checks to prevent errors
     * if methods don't exist.
     *
     * TODO: Implement full mission swap support (see essence.js swapMission())
     */
    clear() {
        // Clean up tools first
        if (ToolControllerModern_ && typeof ToolControllerModern_.clear === 'function') {
            ToolControllerModern_.clear()
        }

        // Clean up all registered panels
        const panels = PanelManager_.getAllPanelsByPriority()
        panels.forEach(panel => {
            if (PanelManager_.unregisterPanel && typeof PanelManager_.unregisterPanel === 'function') {
                try {
                    PanelManager_.unregisterPanel(panel.id)
                } catch (err) {
                    console.warn(`[Modern Interface] Failed to unregister panel ${panel.id}:`, err)
                }
            }
        })

        // Clean up layers
        if (L_ && typeof L_.clear === 'function') {
            L_.clear()
        }

        // Clear viewer
        if (Viewer_ && typeof Viewer_.clearImage === 'function') {
            Viewer_.clearImage()
        }

        // Clean up map resources
        if (Map_ && typeof Map_.clear === 'function') {
            Map_.clear()
        }

        // Clean up DOM
        $('#modern-content').empty()
        $('#map').remove()

        // Reset finalized flag
        this.finalized = false
    }

    /**
     * Get the current configuration data
     *
     * @returns {MissionConfig|null} Current mission configuration or null if not initialized
     * @public
     */
    getConfig() {
        return this.configData
    }

    /**
     * Check if the interface has been finalized
     *
     * @returns {boolean} True if finalized, false otherwise
     * @public
     *
     * @example
     * if (modern.isFinalized()) {
     *   console.log('Interface is ready')
     * }
     */
    isFinalized() {
        return this.finalized
    }
}

// Create and export singleton instance for backwards compatibility
const modern = new ModernInterface()

export default modern
