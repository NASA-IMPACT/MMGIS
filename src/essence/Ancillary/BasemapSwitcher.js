/**
 * BasemapSwitcher.js
 *
 * A floating UI control that lets the user switch between configured
 * basemap styles (e.g. Streets, Satellite, Terrain) at runtime.
 *
 * Reads style presets from `L_.configData.msv.basemap.styles[]` and
 * calls `Map_.engine.setBasemapStyle(url)` to apply the selected style
 * to the underlying MapLibre/Mapbox GL basemap in both Leaflet and
 * deck.gl adapter modes.
 *
 * If no styles[] array is configured, sensible defaults are generated
 * based on the basemap provider.
 */

import $ from 'jquery'
import L_ from '../Basics/Layers_/Layers_'

let Map_ = null
let _container = null
let _activeIndex = 0

/**
 * Default style presets for Mapbox provider.
 */
const MAPBOX_DEFAULTS = [
    { name: 'Streets', style: 'mapbox://styles/mapbox/streets-v12' },
    { name: 'Satellite', style: 'mapbox://styles/mapbox/satellite-streets-v12' },
    { name: 'Outdoors', style: 'mapbox://styles/mapbox/outdoors-v12' },
    { name: 'Light', style: 'mapbox://styles/mapbox/light-v11' },
    { name: 'Dark', style: 'mapbox://styles/mapbox/dark-v11' },
]

/**
 * Default style presets for MapLibre provider.
 * Uses OpenFreeMap styles which are free and require no token.
 */
const MAPLIBRE_DEFAULTS = [
    { name: 'Liberty', style: 'https://tiles.openfreemap.org/styles/liberty' },
    { name: 'Bright', style: 'https://tiles.openfreemap.org/styles/bright' },
    { name: 'Positron', style: 'https://tiles.openfreemap.org/styles/positron' },
]

const BasemapSwitcher = {
    /**
     * Initialise and mount the basemap switcher control.
     *
     * @param {object} mapRef - Reference to the Map_ module.
     */
    init(mapRef) {
        Map_ = mapRef

        const basemapConfig = L_.configData?.msv?.basemap
        if (!basemapConfig || !basemapConfig.provider || basemapConfig.provider === 'none') {
            return
        }

        // Use configured styles, or auto-generate defaults based on provider
        let styles = basemapConfig.styles
        if (!styles || styles.length === 0) {
            styles = this._getDefaultStyles(basemapConfig)
        }

        if (!styles || styles.length === 0) {
            return
        }

        // Determine which style is initially active (match against basemap.style)
        _activeIndex = 0
        styles.forEach((s, i) => {
            if (s.style === basemapConfig.style) {
                _activeIndex = i
            }
        })

        // Build the DOM
        this._buildUI(styles)
    },

    /**
     * Remove the switcher from the DOM.
     */
    destroy() {
        $(document).off('click.basemapSwitcher')
        if (_container) {
            _container.remove()
            _container = null
        }
    },

    /**
     * Generate default style presets based on the basemap provider.
     * If the configured style URL is not in the defaults, prepend it as "Current".
     *
     * @param {object} basemapConfig
     * @returns {Array<{name: string, style: string}>}
     */
    _getDefaultStyles(basemapConfig) {
        let defaults
        if (basemapConfig.provider === 'mapbox') {
            defaults = [...MAPBOX_DEFAULTS]
        } else {
            defaults = [...MAPLIBRE_DEFAULTS]
        }

        // If the configured style is already in defaults, we're good.
        const currentInDefaults = defaults.some(
            (d) => d.style === basemapConfig.style
        )

        // If not, prepend the current style so the user can always get back to it.
        if (!currentInDefaults && basemapConfig.style) {
            defaults.unshift({
                name: 'Current',
                style: basemapConfig.style,
            })
        }

        return defaults
    },

    /**
     * Build and append the switcher UI.
     * @param {Array<{name: string, style: string}>} styles
     */
    _buildUI(styles) {
        // Remove previous instance if any
        this.destroy()

        const activeName = styles[_activeIndex]?.name || 'Map'

        // Container
        _container = $('<div>')
            .addClass('mmgis-basemap-switcher')
            .attr('id', 'mmgis-basemap-switcher')

        // Toggle button
        const toggle = $('<div>')
            .addClass('mmgis-basemap-switcher-toggle')
            .attr('title', 'Switch basemap style')
            .html(
                `<i class="mdi mdi-layers mdi-18px"></i><span>${activeName}</span>`
            )
            .on('click', function (e) {
                e.stopPropagation()
                _container.toggleClass('open')
            })

        _container.append(toggle)

        // Options panel
        const options = $('<div>').addClass('mmgis-basemap-switcher-options')

        styles.forEach((styleEntry, index) => {
            const option = $('<div>')
                .addClass('mmgis-basemap-switcher-option')
                .addClass(index === _activeIndex ? 'active' : '')
                .text(styleEntry.name)
                .on('click', function (e) {
                    e.stopPropagation()
                    BasemapSwitcher._selectStyle(index, styles)
                })
            options.append(option)
        })

        _container.append(options)

        // Mount into mapScreen (the map's parent container)
        $('#mapScreen').append(_container)

        // Close on outside click
        $(document).on('click.basemapSwitcher', function () {
            if (_container) _container.removeClass('open')
        })
    },

    /**
     * Handle a style selection.
     *
     * @param {number} index
     * @param {Array<{name: string, style: string}>} styles
     */
    _selectStyle(index, styles) {
        if (index === _activeIndex) {
            _container.removeClass('open')
            return
        }

        _activeIndex = index
        const selectedStyle = styles[index]

        // Apply the style to the basemap
        if (Map_ && Map_.engine) {
            if (typeof Map_.engine.setBasemapStyle === 'function') {
                // Leaflet adapter
                Map_.engine.setBasemapStyle(selectedStyle.style)
            } else if (typeof Map_.engine.getBasemap === 'function') {
                // deck.gl adapter — setStyle on the underlying basemap
                const basemap = Map_.engine.getBasemap()
                if (basemap && typeof basemap.setStyle === 'function') {
                    basemap.setStyle(selectedStyle.style)
                }
            }
        }

        // Update UI
        _container
            .find('.mmgis-basemap-switcher-option')
            .removeClass('active')
            .eq(index)
            .addClass('active')

        _container.find('.mmgis-basemap-switcher-toggle span').text(
            selectedStyle.name
        )

        _container.removeClass('open')
    },
}

export default BasemapSwitcher
