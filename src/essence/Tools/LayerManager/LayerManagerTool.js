/**
 * LayerManagerTool - A layer management tool using event bus architecture
 *
 * This tool provides:
 * - Layer list with visibility toggles
 * - Opacity sliders per layer
 * - Configurable colormap with visual legend preview
 * - Rescale min/max controls
 *
 * IMPORTANT: This tool uses ONLY the event bus (window.mmgisAPI) for
 * communication with core modules - no direct imports from L_, Map_, etc.
 */

import $ from 'jquery'
import { evaluate_cmap } from '../../../external/js-colormaps/js-colormaps.js'
import './LayerManagerTool.css'

// Available matplotlib-style colormaps
const MATPLOTLIB_COLORMAPS = [
    'viridis',
    'plasma',
    'inferno',
    'magma',
    'cividis',
    'Greys',
    'Purples',
    'Blues',
    'Greens',
    'Oranges',
    'Reds',
    'YlOrBr',
    'YlOrRd',
    'OrRd',
    'PuRd',
    'RdPu',
    'BuPu',
    'GnBu',
    'PuBu',
    'YlGnBu',
    'PuBuGn',
    'BuGn',
    'YlGn',
    'binary',
    'gist_yarg',
    'gist_gray',
    'gray',
    'bone',
    'pink',
    'spring',
    'summer',
    'autumn',
    'winter',
    'cool',
    'Wistia',
    'hot',
    'afmhot',
    'gist_heat',
    'copper',
    'PiYG',
    'PRGn',
    'BrBG',
    'PuOr',
    'RdGy',
    'RdBu',
    'RdYlBu',
    'RdYlGn',
    'Spectral',
    'coolwarm',
    'bwr',
    'seismic',
    'twilight',
    'twilight_shifted',
    'hsv',
    'jet',
    'turbo',
    'rainbow',
    'gist_rainbow',
    'nipy_spectral',
    'gist_ncar',
]

// Provider/event cleanup functions
let _cleanups = []

/**
 * Generate a CSS gradient string for a colormap
 * @param {string} colormapName - Name of the colormap
 * @returns {string} CSS linear-gradient string
 */
function generateColormapGradient(colormapName) {
    const steps = 10
    const colors = []

    // Check if it's a reversed colormap
    let name = colormapName
    let reverse = false
    if (colormapName.endsWith('_r')) {
        name = colormapName.slice(0, -2)
        reverse = true
    }

    for (let i = 0; i <= steps; i++) {
        const value = i / steps
        try {
            const rgb = evaluate_cmap(value, name, reverse)
            colors.push(`rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`)
        } catch (e) {
            // Fallback to grayscale if colormap not found
            const gray = Math.round(value * 255)
            colors.push(`rgb(${gray}, ${gray}, ${gray})`)
        }
    }

    return `linear-gradient(to right, ${colors.join(', ')})`
}

const LayerManagerTool = {
    height: 0,
    width: 380,
    vars: {},
    MMGISInterface: null,

    initialize: function () {
        // Tool initialization - called once when tool is loaded
    },

    make: function () {
        this.MMGISInterface = new InterfaceWithMMGIS()
    },

    destroy: function () {
        if (this.MMGISInterface) {
            this.MMGISInterface.cleanup()
        }
        // Clean up all subscriptions
        _cleanups.forEach((fn) => {
            if (typeof fn === 'function') fn()
        })
        _cleanups = []
    },

    getUrlString: function () {
        return ''
    },
}

function InterfaceWithMMGIS() {
    const api = window.mmgisAPI
    if (!api) {
        console.error('LayerManagerTool: mmgisAPI not available')
        return
    }

    // Store cleanup function reference
    this.cleanup = cleanup

    // Get the tool panel
    const tools = $('#toolPanel')
    tools.css('background', 'var(--color-k)')
    tools.empty()

    // Build the UI
    const markup = buildMarkup()
    tools.html(markup)

    // Initialize the layer list
    refreshLayerList()

    // Subscribe to events
    const unsubVisibility = api.on(
        'layer:visibilityChange',
        ({ layerName, visible }) => {
            updateLayerVisibilityUI(layerName, visible)
        }
    )
    _cleanups.push(unsubVisibility)

    const unsubOpacity = api.on('layer:opacityChange', ({ layerUUID, opacity }) => {
        updateLayerOpacityUI(layerUUID, opacity)
    })
    _cleanups.push(unsubOpacity)

    const unsubColormap = api.on(
        'layer:colormapChange',
        ({ layerUUID, colormap }) => {
            updateLayerColormapUI(layerUUID, colormap)
        }
    )
    _cleanups.push(unsubColormap)

    const unsubRescale = api.on(
        'layer:rescaleChange',
        ({ layerUUID, currentCogMin, currentCogMax }) => {
            updateLayerRescaleUI(layerUUID, currentCogMin, currentCogMax)
        }
    )
    _cleanups.push(unsubRescale)

    // Bind event handlers
    bindEventHandlers()

    function buildMarkup() {
        return `
            <div id="layerManagerTool">
                <div class="lm-header">
                    <div class="lm-title">Layer Manager</div>
                    <div class="lm-actions">
                        <button class="lm-refresh" title="Refresh layer list">
                            <i class="mdi mdi-refresh mdi-18px"></i>
                        </button>
                    </div>
                </div>
                <div class="lm-search">
                    <i class="mdi mdi-magnify mdi-18px"></i>
                    <input type="text" placeholder="Search layers..." class="lm-search-input" />
                    <button class="lm-search-clear" title="Clear search">
                        <i class="mdi mdi-close mdi-14px"></i>
                    </button>
                </div>
                <div class="lm-content mmgisScrollbar">
                    <ul class="lm-layer-list"></ul>
                </div>
            </div>
        `
    }

    async function refreshLayerList() {
        const listEl = $('#layerManagerTool .lm-layer-list')
        listEl.empty()

        try {
            // Get all layers via event bus
            const layerUUIDs = await api.request('layers:getAll')
            const visibleLayers = await api.request('layers:getVisible')

            for (const uuid of layerUUIDs) {
                const config = await api.request('layers:getConfig', uuid)
                if (!config || config.type === 'header') continue

                const isVisible = visibleLayers[uuid] === true
                const opacity = await api.request('layers:getOpacity', uuid)
                const cogSettings = await api.request('layers:getCogSettings', uuid)

                const layerHtml = buildLayerItem(
                    uuid,
                    config,
                    isVisible,
                    opacity,
                    cogSettings
                )
                listEl.append(layerHtml)
            }
        } catch (err) {
            console.error('LayerManagerTool: Error refreshing layer list', err)
            listEl.html(
                '<li class="lm-error">Error loading layers. Check console for details.</li>'
            )
        }
    }

    function buildLayerItem(uuid, config, isVisible, opacity, cogSettings) {
        const displayName = config.display_name || config.name

        // Show colormap controls for tile, image, and velocity layers
        // These are the layer types that can use colormaps for visualization
        const supportsColormap = ['tile', 'image', 'velocity'].includes(config.type)

        let cogControlsHtml = ''
        if (supportsColormap) {
            const currentColormap = cogSettings?.cogColormap || 'viridis'
            const currentGradient = generateColormapGradient(currentColormap)

            // Build colormap options with visual gradients
            const colormapOptions = MATPLOTLIB_COLORMAPS.map((cm) => {
                const gradient = generateColormapGradient(cm)
                const gradientReversed = generateColormapGradient(cm + '_r')
                const isSelectedNormal = currentColormap === cm
                const isSelectedReversed = currentColormap === cm + '_r'

                return `
                    <div class="lm-colormap-option ${isSelectedNormal ? 'selected' : ''}"
                         data-colormap="${cm}" data-uuid="${uuid}">
                        <div class="lm-colormap-preview" style="background: ${gradient}"></div>
                        <span class="lm-colormap-name">${cm}</span>
                    </div>
                    <div class="lm-colormap-option ${isSelectedReversed ? 'selected' : ''}"
                         data-colormap="${cm}_r" data-uuid="${uuid}">
                        <div class="lm-colormap-preview" style="background: ${gradientReversed}"></div>
                        <span class="lm-colormap-name">${cm}_r</span>
                    </div>
                `
            }).join('')

            const currentMin =
                cogSettings?.currentCogMin ?? cogSettings?.cogMin ?? 0
            const currentMax =
                cogSettings?.currentCogMax ?? cogSettings?.cogMax ?? 255
            const units = cogSettings?.cogUnits || ''

            // Colormap bar is always visible, clicking it expands the full controls
            cogControlsHtml = `
                <div class="lm-colormap-bar" data-uuid="${uuid}">
                    <div class="lm-colormap-preview-bar" style="background: ${currentGradient}"></div>
                    <div class="lm-colormap-bar-info">
                        <span class="lm-colormap-bar-name">${currentColormap}</span>
                        <span class="lm-colormap-bar-range">${currentMin} - ${currentMax}${units ? ' ' + units : ''}</span>
                    </div>
                    <i class="mdi mdi-chevron-down mdi-14px lm-colormap-bar-chevron"></i>
                </div>
                <div class="lm-cog-controls" data-uuid="${uuid}">
                    <div class="lm-cog-section">
                        <label>Colormap</label>
                        <div class="lm-colormap-dropdown" data-uuid="${uuid}">
                            <div class="lm-colormap-search">
                                <input type="text" placeholder="Search colormaps..." class="lm-colormap-search-input" />
                            </div>
                            <div class="lm-colormap-list mmgisScrollbar">
                                ${colormapOptions}
                            </div>
                        </div>
                    </div>
                    <div class="lm-cog-row lm-rescale-row">
                        <div class="lm-rescale-field">
                            <label>Min${units ? ' (' + units + ')' : ''}</label>
                            <input type="number" class="lm-rescale-min" data-uuid="${uuid}"
                                   value="${currentMin}" step="any" />
                        </div>
                        <div class="lm-rescale-field">
                            <label>Max${units ? ' (' + units + ')' : ''}</label>
                            <input type="number" class="lm-rescale-max" data-uuid="${uuid}"
                                   value="${currentMax}" step="any" />
                        </div>
                    </div>
                    <div class="lm-cog-row lm-cog-actions">
                        <button class="lm-apply-cog" data-uuid="${uuid}">Apply</button>
                        <button class="lm-reset-cog" data-uuid="${uuid}"
                                data-default-min="${cogSettings?.cogMin ?? 0}"
                                data-default-max="${cogSettings?.cogMax ?? 255}">Reset</button>
                    </div>
                </div>
            `
        }

        return `
            <li class="lm-layer-item ${isVisible ? 'visible' : ''}" data-uuid="${uuid}">
                <div class="lm-layer-header">
                    <div class="lm-visibility">
                        <input type="checkbox" class="lm-visibility-checkbox"
                               data-uuid="${uuid}" ${isVisible ? 'checked' : ''} />
                    </div>
                    <div class="lm-layer-name" title="${displayName}">${displayName}</div>
                    <div class="lm-layer-type">${config.type}</div>
                </div>
                <div class="lm-opacity-control">
                    <label>Opacity</label>
                    <input type="range" class="lm-opacity-slider" data-uuid="${uuid}"
                           min="0" max="1" step="0.01" value="${opacity}" />
                    <span class="lm-opacity-value">${Math.round(opacity * 100)}%</span>
                </div>
                ${cogControlsHtml}
            </li>
        `
    }

    function bindEventHandlers() {
        // Refresh button
        $('#layerManagerTool .lm-refresh').on('click', refreshLayerList)

        // Search filter
        $('#layerManagerTool .lm-search-input').on('input', function () {
            const query = $(this).val().toLowerCase()
            $('#layerManagerTool .lm-layer-item').each(function () {
                const name = $(this).find('.lm-layer-name').text().toLowerCase()
                $(this).toggle(name.includes(query))
            })
            // Show/hide clear button
            if (query) {
                $('#layerManagerTool .lm-search-clear').addClass('shown')
            } else {
                $('#layerManagerTool .lm-search-clear').removeClass('shown')
            }
        })

        // Search clear button
        $('#layerManagerTool .lm-search-clear').on('click', function () {
            $('#layerManagerTool .lm-search-input').val('').trigger('input')
        })

        // Visibility toggle
        $('#layerManagerTool').on(
            'change',
            '.lm-visibility-checkbox',
            async function () {
                const uuid = $(this).data('uuid')
                await api.request('layers:toggle', uuid)
            }
        )

        // Opacity slider
        $('#layerManagerTool').on('input', '.lm-opacity-slider', async function () {
            const uuid = $(this).data('uuid')
            const opacity = parseFloat($(this).val())
            $(this)
                .siblings('.lm-opacity-value')
                .text(Math.round(opacity * 100) + '%')
            await api.request('layers:setOpacity', { layerUUID: uuid, opacity })
        })

        // Click colormap bar to expand/collapse COG controls
        $('#layerManagerTool').on('click', '.lm-colormap-bar', function () {
            const uuid = $(this).data('uuid')
            const controls = $(`.lm-cog-controls[data-uuid="${uuid}"]`)

            // Close other expanded controls first
            $('.lm-cog-controls.expanded').not(controls).removeClass('expanded')
            $('.lm-colormap-bar').not(this).find('.lm-colormap-bar-chevron')
                .removeClass('mdi-chevron-up').addClass('mdi-chevron-down')

            controls.toggleClass('expanded')
            $(this).find('.lm-colormap-bar-chevron')
                .toggleClass('mdi-chevron-down mdi-chevron-up')
        })

        // Search colormaps within dropdown
        $('#layerManagerTool').on('input', '.lm-colormap-search-input', function () {
            const query = $(this).val().toLowerCase()
            const dropdown = $(this).closest('.lm-colormap-dropdown')
            dropdown.find('.lm-colormap-option').each(function () {
                const name = $(this).data('colormap').toLowerCase()
                $(this).toggle(name.includes(query))
            })
        })

        // Select colormap from dropdown
        $('#layerManagerTool').on('click', '.lm-colormap-option', function () {
            const uuid = $(this).data('uuid')
            const colormap = $(this).data('colormap')
            const gradient = generateColormapGradient(colormap)

            // Update the colormap bar display
            const bar = $(`.lm-colormap-bar[data-uuid="${uuid}"]`)
            bar.find('.lm-colormap-preview-bar').css('background', gradient)
            bar.find('.lm-colormap-bar-name').text(colormap)

            // Mark as selected in the list
            $(`.lm-colormap-option[data-uuid="${uuid}"]`).removeClass('selected')
            $(this).addClass('selected')

            // Store selected colormap
            bar.data('selected-colormap', colormap)
        })

        // Apply COG settings
        $('#layerManagerTool').on('click', '.lm-apply-cog', async function () {
            const uuid = $(this).data('uuid')
            const bar = $(`.lm-colormap-bar[data-uuid="${uuid}"]`)
            const colormap = bar.data('selected-colormap') || bar.find('.lm-colormap-bar-name').text()
            const min = parseFloat(
                $(`.lm-rescale-min[data-uuid="${uuid}"]`).val()
            )
            const max = parseFloat(
                $(`.lm-rescale-max[data-uuid="${uuid}"]`).val()
            )

            // Show loading state
            $(this).prop('disabled', true).text('Applying...')

            try {
                // Set colormap and rescale via event bus
                if (colormap) {
                    await api.request('layers:setColormap', {
                        layerUUID: uuid,
                        colormap,
                    })
                }
                if (!isNaN(min) && !isNaN(max)) {
                    await api.request('layers:setRescale', {
                        layerUUID: uuid,
                        min,
                        max,
                    })
                }

                // Update the bar display with new range
                bar.find('.lm-colormap-bar-range').text(`${min} - ${max}`)
            } catch (err) {
                console.error('LayerManagerTool: Error applying COG settings', err)
            } finally {
                $(this).prop('disabled', false).text('Apply')
            }
        })

        // Reset COG settings
        $('#layerManagerTool').on('click', '.lm-reset-cog', async function () {
            const uuid = $(this).data('uuid')
            const defaultMin = parseFloat($(this).data('default-min')) || 0
            const defaultMax = parseFloat($(this).data('default-max')) || 255

            // Update input fields
            $(`.lm-rescale-min[data-uuid="${uuid}"]`).val(defaultMin)
            $(`.lm-rescale-max[data-uuid="${uuid}"]`).val(defaultMax)

            // Show loading state
            $(this).prop('disabled', true).text('Resetting...')

            try {
                await api.request('layers:setRescale', {
                    layerUUID: uuid,
                    min: defaultMin,
                    max: defaultMax,
                })

                // Update the bar display with reset range
                const bar = $(`.lm-colormap-bar[data-uuid="${uuid}"]`)
                bar.find('.lm-colormap-bar-range').text(`${defaultMin} - ${defaultMax}`)
            } catch (err) {
                console.error('LayerManagerTool: Error resetting COG settings', err)
            } finally {
                $(this).prop('disabled', false).text('Reset')
            }
        })
    }

    function updateLayerVisibilityUI(layerUUID, visible) {
        const item = $(`.lm-layer-item[data-uuid="${layerUUID}"]`)
        item.toggleClass('visible', visible)
        item.find('.lm-visibility-checkbox').prop('checked', visible)
    }

    function updateLayerOpacityUI(layerUUID, opacity) {
        $(`.lm-opacity-slider[data-uuid="${layerUUID}"]`).val(opacity)
        $(`.lm-layer-item[data-uuid="${layerUUID}"] .lm-opacity-value`).text(
            Math.round(opacity * 100) + '%'
        )
    }

    function updateLayerColormapUI(layerUUID, colormap) {
        $(`.lm-colormap-select[data-uuid="${layerUUID}"]`).val(colormap)
    }

    function updateLayerRescaleUI(layerUUID, min, max) {
        $(`.lm-rescale-min[data-uuid="${layerUUID}"]`).val(min)
        $(`.lm-rescale-max[data-uuid="${layerUUID}"]`).val(max)
    }

    function cleanup() {
        $('#layerManagerTool').off()
        $('#toolPanel').empty()
    }
}

export default LayerManagerTool
