import $ from 'jquery'
// TODO: tighten in follow-up. React 19 removed ReactDOM.render in favor of createRoot.
// Minimal shim during Task R1 React 16->19 upgrade; LayerManager is rewritten in Task 20.
import { createRoot } from 'react-dom/client'
import React, { useState, useEffect } from 'react'

let _layerManagerRoot = null

import LayerLegendContainer from './components/LayerLegendContainer'
import './components/LayerLegend.css'
import './LayerManagerTool.css'

/**
 * Helper to safely call event bus request
 * @param {string} name - Request name
 * @param {*} params - Request parameters
 * @returns {Promise<*>} - Response or null if unavailable
 */
const request = async (name, params) => {
    if (window.mmgisAPI?.request) {
        return window.mmgisAPI.request(name, params)
    }
    return null
}

// Expose state setters externally for the tool module to update React state
const state = {
    setLayers: null,
    setLoading: null,
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

        // Trigger initial data load now that setters are available
        // Use setTimeout to ensure the state setters are registered before updateLayers runs
        setTimeout(() => {
            LayerManagerTool.updateLayers()
        }, 0)
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
                    emptyMessage="No visible layers. Turn on layers in the Layers tool to manage them here."
                    onVisibilityChange={LayerManagerTool.handleVisibilityChange}
                    onOpacityChange={LayerManagerTool.handleOpacityChange}
                    onColormapChange={LayerManagerTool.handleColormapChange}
                    onRescaleChange={LayerManagerTool.handleRescaleChange}
                    onCogReset={LayerManagerTool.handleCogReset}
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
    initialize: async function () {
        // Get tool variables from configuration via event bus
        this.vars = (await request('tool:getVars', 'layermanager')) || {}

        // Set custom width if configured
        if (this.vars.width) {
            this.width = this.vars.width
        }

        // Handle mobile layout
        const isMobile = await request('app:isMobile')
        if (isMobile) {
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

            // Subscribe to opacity change events
            this._cleanups.push(
                window.mmgisAPI.on('layer:opacityChange', () => {
                    if (this._mounted) {
                        this.updateLayers()
                    }
                })
            )
        }
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
        // Note: Initial data load is triggered in the React component's useEffect
        // to ensure state setters are available before updateLayers is called
        _layerManagerRoot = createRoot(container)
        _layerManagerRoot.render(<LayerManager />)
        this._mounted = true

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
        if (_layerManagerRoot) {
            _layerManagerRoot.unmount()
            _layerManagerRoot = null
        }

        this._mounted = false

        // Clean up event subscriptions
        this._cleanups.forEach((cleanup) => {
            if (typeof cleanup === 'function') {
                cleanup()
            }
        })
        this._cleanups = []
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
    updateLayers: async function () {
        // Ensure state setters are available (React useEffect has run)
        if (!state.setLayers || !state.setLoading) {
            return
        }
        try {
            const layerData = await this.getVisibleLayersWithLegends()
            state.setLayers(layerData)
            state.setLoading(false)
        } catch (err) {
            console.error('LayerManagerTool: Error updating layers', err)
            state.setLayers([])
            state.setLoading(false)
        }
    },

    /**
     * Get layers for display (all layers or only visible, based on config)
     * @returns {Promise<Array>} Array of layer legend data objects
     */
    getVisibleLayersWithLegends: async function () {
        const layers = []
        const showOnlyVisible = this.vars.showOnlyVisible === true

        // Get layer data via event bus
        const layerConfigs = await request('layers:getAllConfigs')
        const visibleLayers = await request('layers:getVisible')
        const opacities = await request('layers:getAllOpacities')

        if (!layerConfigs) {
            return layers
        }

        // Iterate through all layers in data (not just 'on' layers)
        Object.keys(layerConfigs).forEach((layerName) => {
            const layerConfig = layerConfigs[layerName]
            if (!layerConfig) return

            // Skip header layers
            if (layerConfig.type === 'header') return

            // If showOnlyVisible is true, skip layers that are off
            const isVisible = visibleLayers?.[layerName] === true
            if (showOnlyVisible && !isVisible) return

            // Build legend data from layer config (returns data even without legend)
            const legendData = this.buildLayerLegendData(layerName, layerConfig, opacities)
            // Add visibility state to the legend data
            legendData.visible = isVisible
            layers.push(legendData)
        })

        return layers
    },

    /**
     * Build legend data object from MMGIS layer configuration
     * @param {string} layerName - Layer name/UUID
     * @param {object} layerConfig - Layer configuration object
     * @param {object} opacities - Opacity map for all layers
     * @returns {object} Legend data object (always returns, even without legend)
     */
    buildLayerLegendData: function (layerName, layerConfig, opacities) {
        const legend = layerConfig._legend
        const opacity = opacities?.[layerName] ?? 1

        // Check if this layer supports colormap/rescale controls
        // This applies only to tile/image layers with cogTransform enabled (TiTiler + COG translate)
        const supportedTypes = ['tile', 'image']
        const hasColormapSupport =
            supportedTypes.includes(layerConfig.type) &&
            layerConfig.cogTransform === true

        const cogData = hasColormapSupport
            ? {
                  isCog: true,
                  colormap: layerConfig.currentCogColormap || layerConfig.cogColormap || 'viridis',
                  min: layerConfig.currentCogMin ?? layerConfig.cogMin ?? 0,
                  max: layerConfig.currentCogMax ?? layerConfig.cogMax ?? 255,
                  defaultMin: layerConfig.cogMin ?? 0,
                  defaultMax: layerConfig.cogMax ?? 255,
                  defaultColormap: layerConfig.cogColormap || 'viridis',
                  units: layerConfig.cogUnits || null,
                  titilerUrl: layerConfig.titilerUrl || null,
              }
            : null

        const baseData = {
            id: layerName,
            title: layerConfig.display_name || layerName,
            description: layerConfig.description || null,
            opacity: opacity,
            type: 'none',
            cog: cogData,
        }

        // Check for legend data
        if (!legend || (Array.isArray(legend) && legend.length === 0)) {
            // For COG layers without legend, create a gradient legend from COG settings
            if (hasColormapSupport && cogData) {
                baseData.type = 'gradient'
                baseData.min = cogData.min
                baseData.max = cogData.max
                baseData.stops = null // Will use colormap image instead
                baseData.unit = cogData.units ? { label: cogData.units } : null
            }
            return baseData
        }

        // Determine legend type and build appropriate data structure
        const legendType = this.detectLegendType(legend)
        baseData.type = legendType

        switch (legendType) {
            case 'gradient':
                return this.buildGradientLegendData(baseData, legend)
            case 'categorical':
                return this.buildCategoricalLegendData(baseData, legend)
            case 'text':
                return baseData
            default:
                return baseData
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

    /**
     * Handle visibility change for a layer
     * @param {string} layerName - Layer name/UUID
     */
    handleVisibilityChange: async function (layerName) {
        // Toggle the layer via event bus
        const newVisibility = await request('layers:toggle', layerName)

        if (newVisibility !== null) {
            // Emit event for other tools
            if (window.mmgisAPI) {
                window.mmgisAPI.emit('layer:visibilityChange', {
                    layerName,
                    visible: newVisibility,
                })
            }
        }
    },

    /**
     * Handle opacity change for a layer
     * @param {string} layerName - Layer name/UUID
     * @param {number} opacity - New opacity value (0-1)
     */
    handleOpacityChange: async function (layerName, opacity) {
        // Set opacity via event bus
        const success = await request('layers:setOpacity', { layerUUID: layerName, opacity })

        if (success) {
            // Emit event for other tools
            if (window.mmgisAPI) {
                window.mmgisAPI.emit('layer:opacityChange', {
                    layerName,
                    opacity,
                })
            }
        }
    },

    /**
     * Handle colormap change for a COG layer
     * @param {string} layerName - Layer name/UUID
     * @param {string} colormap - New colormap name
     */
    handleColormapChange: async function (layerName, colormap) {
        // Get layer config to check if it's a COG layer
        const layerConfig = await request('layers:getConfig', layerName)
        if (!layerConfig || !layerConfig.cogTransform) return

        // Update the layer config via event bus
        await request('layers:updateConfig', {
            layerUUID: layerName,
            updates: { currentCogColormap: colormap },
        })

        // Refresh the tile layer with updated options
        await request('layers:refresh', {
            layerUUID: layerName,
            options: { cogColormap: colormap },
        })

        // Update our display
        LayerManagerTool.updateLayers()

        // Emit event for other tools
        if (window.mmgisAPI) {
            window.mmgisAPI.emit('layer:cogColormapChange', {
                layerName,
                colormap,
            })
        }
    },

    /**
     * Handle rescale change for a COG layer
     * @param {string} layerName - Layer name/UUID
     * @param {number} min - New min value
     * @param {number} max - New max value
     */
    handleRescaleChange: async function (layerName, min, max) {
        // Get layer config to check if it's a COG layer
        const layerConfig = await request('layers:getConfig', layerName)
        if (!layerConfig || !layerConfig.cogTransform) return

        // Update the layer config via event bus
        await request('layers:updateConfig', {
            layerUUID: layerName,
            updates: { currentCogMin: min, currentCogMax: max },
        })

        // Refresh the tile layer with updated options
        await request('layers:refresh', {
            layerUUID: layerName,
            options: { currentCogMin: min, currentCogMax: max },
        })

        // Update our display
        LayerManagerTool.updateLayers()

        // Emit event for other tools
        if (window.mmgisAPI) {
            window.mmgisAPI.emit('layer:cogRescaleChange', {
                layerName,
                min,
                max,
            })
        }
    },

    /**
     * Reset COG layer to default colormap and rescale values
     * @param {string} layerName - Layer name/UUID
     */
    handleCogReset: async function (layerName) {
        // Get layer config to check if it's a COG layer and get defaults
        const layerConfig = await request('layers:getConfig', layerName)
        if (!layerConfig || !layerConfig.cogTransform) return

        // Reset to defaults via event bus
        await request('layers:updateConfig', {
            layerUUID: layerName,
            updates: {
                currentCogColormap: layerConfig.cogColormap,
                currentCogMin: layerConfig.cogMin,
                currentCogMax: layerConfig.cogMax,
            },
        })

        // Refresh the tile layer with default options
        await request('layers:refresh', {
            layerUUID: layerName,
            options: {
                cogColormap: layerConfig.cogColormap,
                currentCogMin: layerConfig.cogMin,
                currentCogMax: layerConfig.cogMax,
            },
        })

        // Update our display
        LayerManagerTool.updateLayers()

        // Emit event for other tools
        if (window.mmgisAPI) {
            window.mmgisAPI.emit('layer:cogReset', { layerName })
        }
    },
}

export default LayerManagerTool
