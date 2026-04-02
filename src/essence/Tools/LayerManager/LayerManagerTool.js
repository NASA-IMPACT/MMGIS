import $ from 'jquery'
import ReactDOM from 'react-dom'
import React, { useState, useEffect } from 'react'

import L_ from '../../Basics/Layers_/Layers_'
import ToolController_ from '../../Basics/ToolController_/ToolController_'

import LayerLegendContainer from './components/LayerLegendContainer'
import './components/LayerLegend.css'
import './LayerManagerTool.css'

// Expose state setters externally for the tool module to update React state
const state = {
    setLayers: () => {},
    setLoading: () => {},
}

/**
 * LayerManager React Component
 * Renders a list of layer legends for all visible layers
 */
const LayerManager = () => {
    const [layers, setLayers] = useState([])
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        // Expose setters to the tool module
        state.setLayers = setLayers
        state.setLoading = setLoading
    }, [])

    if (loading) {
        return (
            <div className="layer-manager-tool">
                <div className="layer-manager-header">
                    <div className="layer-manager-title">Layer Manager</div>
                </div>
                <div className="layer-manager-content">
                    <div className="layer-manager-loading">
                        <div className="mmgisLoading"></div>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="layer-manager-tool">
            <div className="layer-manager-header">
                <div className="layer-manager-title">Layer Manager</div>
                <div className="layer-manager-actions">
                    <div
                        className="layer-manager-action"
                        title="Refresh legends"
                        onClick={() => LayerManagerTool.updateLayers()}
                    >
                        <i className="mdi mdi-refresh mdi-18px" />
                    </div>
                </div>
            </div>
            <div className="layer-manager-content">
                <LayerLegendContainer
                    layers={layers}
                    emptyMessage="No layers with legends are currently visible. Turn on layers in the Layers tool to see their legends here."
                />
            </div>
        </div>
    )
}

/**
 * LayerManagerTool - MMGIS Tool Module
 *
 * This tool displays layer legends for all visible layers using a React-based UI.
 * It uses the event bus architecture for communication with core modules.
 */
const LayerManagerTool = {
    height: 0,
    width: 320,
    vars: {},
    _cleanups: [],
    _mounted: false,

    /**
     * Initialize the tool - called once at application startup
     */
    initialize: function () {
        // Get tool variables from configuration
        this.vars = L_.getToolVars('layermanager') || {}

        // Set custom width if configured
        if (this.vars.width) {
            this.width = this.vars.width
        }

        // Handle mobile layout
        if (L_.UserInterface_.isMobile === true) {
            this.width = 'full'
            this.height = 500
        }

        // Subscribe to layer visibility changes via event bus
        if (window.mmgisAPI) {
            this._cleanups.push(
                window.mmgisAPI.on('layer:visibilityChange', () => {
                    if (this._mounted) {
                        this.updateLayers()
                    }
                })
            )

            // Subscribe to layer refresh events (e.g., when COG legends are populated)
            this._cleanups.push(
                window.mmgisAPI.on('layer:refreshStatusChange', () => {
                    if (this._mounted) {
                        this.updateLayers()
                    }
                })
            )
        }

        // Also subscribe via legacy L_ method for compatibility
        L_.subscribeOnLayerToggle('LayerManagerTool', () => {
            if (this._mounted) {
                this.updateLayers()
            }
        })
    },

    /**
     * Make the tool - called when user selects this tool
     */
    make: function () {
        const container = document.getElementById('toolPanel')
        if (!container) {
            console.error('LayerManagerTool: toolPanel not found')
            return
        }

        // Set panel background
        $(container).css('background', 'var(--color-k)')

        // Render React component
        ReactDOM.render(<LayerManager />, container)
        this._mounted = true

        // Initial data load
        this.updateLayers()

        // Register providers via event bus
        if (window.mmgisAPI) {
            // Provide method to get currently displayed layers
            this._cleanups.push(
                window.mmgisAPI.provide('plugin:layermanager:getLayers', () => {
                    return this.getVisibleLayersWithLegends()
                })
            )

            // Provide method to force refresh
            this._cleanups.push(
                window.mmgisAPI.provide('plugin:layermanager:refresh', () => {
                    this.updateLayers()
                    return true
                })
            )

            // Emit ready event
            window.mmgisAPI.emit('plugin:layermanager:ready', {
                timestamp: Date.now(),
            })
        }
    },

    /**
     * Destroy the tool - called when user switches to different tool
     */
    destroy: function () {
        const container = document.getElementById('toolPanel')
        if (container) {
            ReactDOM.unmountComponentAtNode(container)
        }

        this._mounted = false

        // Clean up event subscriptions
        this._cleanups.forEach((cleanup) => {
            if (typeof cleanup === 'function') {
                cleanup()
            }
        })
        this._cleanups = []

        // Unsubscribe from legacy layer toggle
        L_.unsubscribeOnLayerToggle('LayerManagerTool')
    },

    /**
     * Get URL string for state persistence (optional)
     */
    getUrlString: function () {
        return ''
    },

    /**
     * Update the layers list in the React component
     */
    updateLayers: function () {
        const layerData = this.getVisibleLayersWithLegends()
        state.setLayers(layerData)
        state.setLoading(false)
    },

    /**
     * Get all visible layers that have legend data
     * @returns {Array} Array of layer legend data objects
     */
    getVisibleLayersWithLegends: function () {
        const layers = []

        // Iterate through all layers
        Object.keys(L_.layers.on || {}).forEach((layerName) => {
            // Only process visible layers
            if (!L_.layers.on[layerName]) return

            const layerConfig = L_.layers.data[layerName]
            if (!layerConfig) return

            // Skip header layers
            if (layerConfig.type === 'header') return

            // Build legend data from layer config
            const legendData = this.buildLayerLegendData(layerName, layerConfig)
            if (legendData) {
                layers.push(legendData)
            }
        })

        return layers
    },

    /**
     * Build legend data object from MMGIS layer configuration
     * @param {string} layerName - Layer name/UUID
     * @param {object} layerConfig - Layer configuration object
     * @returns {object|null} Legend data object or null if no legend
     */
    buildLayerLegendData: function (layerName, layerConfig) {
        const legend = layerConfig._legend
        const opacity = L_.layers.opacity[layerName] ?? 1

        // Check for legend data
        if (!legend || (Array.isArray(legend) && legend.length === 0)) {
            return null
        }

        // Determine legend type and build appropriate data structure
        const legendType = this.detectLegendType(legend)

        const baseData = {
            id: layerName,
            title: layerConfig.display_name || layerName,
            description: layerConfig.description || null,
            opacity: opacity,
            type: legendType,
        }

        switch (legendType) {
            case 'gradient':
                return this.buildGradientLegendData(baseData, legend)
            case 'categorical':
                return this.buildCategoricalLegendData(baseData, legend)
            case 'text':
                return baseData
            default:
                return null
        }
    },

    /**
     * Detect the type of legend from the legend data
     * @param {Array} legend - Legend data array
     * @returns {'gradient'|'categorical'|'text'} Legend type
     */
    detectLegendType: function (legend) {
        if (!Array.isArray(legend) || legend.length === 0) {
            return 'text'
        }

        // Check first entry for shape type
        const firstEntry = legend[0]

        if (
            firstEntry.shape === 'continuous' ||
            firstEntry.shape === 'discreet'
        ) {
            return 'gradient'
        }

        // If entries have color and value but non-continuous shape, treat as categorical
        if (firstEntry.color && firstEntry.value !== undefined) {
            return 'categorical'
        }

        return 'text'
    },

    /**
     * Build gradient legend data from MMGIS legend format
     * @param {object} baseData - Base legend data
     * @param {Array} legend - MMGIS legend array
     * @returns {object} Gradient legend data
     */
    buildGradientLegendData: function (baseData, legend) {
        // Extract colors and values from legend entries
        const stops = legend.map((entry) => entry.color)
        const values = legend.map((entry) => {
            // Parse numeric value from the value field
            const parsed = parseFloat(entry.value)
            return isNaN(parsed) ? entry.value : parsed
        })

        // Find min and max values
        const numericValues = values.filter((v) => typeof v === 'number')
        const min =
            numericValues.length > 0
                ? Math.min(...numericValues)
                : values[values.length - 1]
        const max = numericValues.length > 0 ? Math.max(...numericValues) : values[0]

        // Extract unit from first value if present (e.g., "100 m" -> "m")
        let unit = null
        if (legend[0]?.value) {
            const match = String(legend[0].value).match(/[\d.]+\s*(.+)/)
            if (match && match[1]) {
                unit = { label: match[1].trim() }
            }
        }

        return {
            ...baseData,
            type: 'gradient',
            stops: stops,
            min: min,
            max: max,
            unit: unit,
        }
    },

    /**
     * Build categorical legend data from MMGIS legend format
     * @param {object} baseData - Base legend data
     * @param {Array} legend - MMGIS legend array
     * @returns {object} Categorical legend data
     */
    buildCategoricalLegendData: function (baseData, legend) {
        // Filter out hidden entries and map to categorical format
        const stops = legend
            .filter((entry) => !entry.hideFromLegend)
            .map((entry) => ({
                color: entry.color,
                label: entry.value || entry.label || '',
            }))

        return {
            ...baseData,
            type: 'categorical',
            stops: stops,
        }
    },
}

export default LayerManagerTool
