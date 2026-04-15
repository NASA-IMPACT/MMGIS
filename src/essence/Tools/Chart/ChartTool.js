import $ from 'jquery'
import L_ from '../../Basics/Layers_/Layers_'
import Chart from 'chart.js/auto'

import './ChartTool.css'

// prettier-ignore
const markup = [
    "<div id='chartTool'>",
    "<div id='chartToolHeader'>",
    "<div id='title'>Time series chart for </div>",
    "<div id='chartToolName'></div>",
    "<div id='chartToolSelectors'></div>",
    "</div>",
    "<div id='chartToolContent'>",
    "<div id='chartToolEmpty'>Click a feature to view its timeseries chart.</div>",
    "</div>",
    "</div>"
].join('\n')

// Color palette for multiple series
const SERIES_COLORS = [
    '#4fc3f7', '#81c784', '#ffb74d', '#e57373',
    '#ba68c8', '#4dd0e1', '#fff176', '#f06292',
    '#aed581', '#90a4ae',
]

let _chartInstance = null

// Cached state for re-rendering when user changes parameter selection
let _cachedGroups = {}       // { "Ozone": [features], "PM10": [features] }
let _cachedGroupNames = []   // Sorted group names
let _cachedXProp = 'datetime'
let _cachedXType = 'time'
let _cachedXLabel = 'Date'
let _cachedYProp = 'value'

const ChartTool = {
    height: 200,
    width: 'full',
    on: false,
    using: null,
    MMGISInterface: null,

    make: function () {
        this.MMGISInterface = new interfaceWithMMGIS()
        this.on = true

        if (this.using != null) {
            fetchAndRender(this.using)
        }
    },
    /**
     * Called by Kinds.js when a feature on a 'chart_tool' layer is clicked.
     * @param {object} layer - The Leaflet layer that was clicked
     */
    use: function (layer) {
        this.using = layer
        if (!this.on) {
            // Auto-open the tool panel by clicking its toolbar button
            const btn = document.getElementById('toolButtonChart')
            if (btn) btn.click()
        } else {
            fetchAndRender(this.using)
        }
    },
    destroy: function () {
        this.MMGISInterface.separateFromMMGIS()
        this.on = false
    },
    getUrlString: function () {
        return ''
    },
}

//
function interfaceWithMMGIS() {
    this.separateFromMMGIS = function () {
        separateFromMMGIS()
    }

    const toolsContainer = $('#tools')
    toolsContainer.css('background', 'var(--color-k)')
    toolsContainer.empty()

    const tools = $('<div>').css('height', '100%').html(markup)
    toolsContainer.append(tools)

    function separateFromMMGIS() {
        destroyChart()
    }
}

/**
 * Destroy the current Chart.js instance.
 */
function destroyChart() {
    if (_chartInstance) {
        _chartInstance.destroy()
        _chartInstance = null
    }
}

/**
 * Interpolate {prop} placeholders in a URL template using feature properties.
 *
 * @param {string} urlTemplate - e.g. "https://api.example.com/items?code={station_code}"
 * @param {object} properties - The clicked feature's properties
 * @returns {string}
 */
function interpolateUrl(urlTemplate, properties) {
    return urlTemplate.replace(/\{([^}]+)\}/g, (match, key) => {
        const val = properties[key]
        return val != null ? encodeURIComponent(val) : match
    })
}

/**
 * Main pipeline: fetch timeseries data and render the chart.
 *
 * @param {object} layer - The Leaflet layer whose feature was clicked
 */
async function fetchAndRender(layer) {
    const layerName = layer.options.layerName
    const layerData = L_.layers.data[layerName]

    if (!layerData || !layerData.variables || !layerData.variables.chart) {
        showError('This layer has no chart configuration.')
        return
    }

    const chartConfig = layerData.variables.chart
    const feature = layer.feature
    const properties = feature.properties

    // Resolve the identifier for the title
    const idValue = feature.properties.local_site_name
        ? feature.properties.local_site_name
        : 'Feature'

    // Show station name in header
    const titleTemplate = chartConfig.title || '{id}'
    const titleText = titleTemplate
        .replace(/\{id\}/g, idValue)
        .replace(/\{([^}]+)\}/g, (_, key) =>
            properties[key] != null ? properties[key] : key
        )
    console.log
    $('#chartToolName').text(titleText)

    // Show loading state
    showLoading()

    // Interpolate and fetch
    const url = interpolateUrl(chartConfig.timeseriesUrl, properties)

    try {
        const response = await fetch(url)
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }
        const data = await response.json()

        const features = data.features || data.results || []
        if (features.length === 0) {
            showEmpty('No timeseries data found for this feature.')
            return
        }

        // Parse axis config with defaults
        _cachedXProp = (chartConfig.xAxis && chartConfig.xAxis.prop) || 'datetime'
        _cachedXType = (chartConfig.xAxis && chartConfig.xAxis.type) || 'time'
        _cachedXLabel = (chartConfig.xAxis && chartConfig.xAxis.label) || 'Date'

        const yAxes = chartConfig.yAxis || [{ prop: 'value' }]
        _cachedYProp = yAxes[0].prop || 'value'

        const groupByProp = chartConfig.groupBy || null

        if (groupByProp) {
            // Group features by the groupBy property
            _cachedGroups = {}
            features.forEach((f) => {
                const groupVal = f.properties[groupByProp] || 'Unknown'
                if (!_cachedGroups[groupVal]) _cachedGroups[groupVal] = []
                _cachedGroups[groupVal].push(f)
            })
            _cachedGroupNames = Object.keys(_cachedGroups).sort()

            // Pick first two groups initially
            const selected = _cachedGroupNames.slice(0, 2)

            // Build parameter selector UI (only if more than 2 groups)
            if (_cachedGroupNames.length > 2) {
                buildSelectors(selected)
            } else {
                $('#chartToolSelectors').empty()
            }

            // Render chart with selected groups
            renderWithSelection(selected)
        } else {
            // No grouping — single series, no selectors needed
            _cachedGroups = {}
            _cachedGroupNames = []
            $('#chartToolSelectors').empty()

            const datasets = buildDatasets(features, yAxes)
            const yLabel =
                (yAxes[0] && yAxes[0].label) ||
                (yAxes[0] && yAxes[0].units) ||
                features[0].properties.units_of_measure ||
                'Value'
            renderChart(datasets, _cachedXLabel, _cachedXType, yLabel)
        }
    } catch (err) {
        console.error('ChartTool: fetch error', err)
        showError(`Failed to load data: ${err.message}`)
    }
}

/**
 * Build the parameter selector dropdowns in the header.
 * Two dropdowns: Left Y-axis and Right Y-axis.
 *
 * @param {Array} selected - Array of 2 selected group names
 */
function buildSelectors(selected) {
    const container = $('#chartToolSelectors')
    container.empty()

    // Left axis dropdown
    const leftSelect = $('<select id="chartSelectLeft" title="Left Y-axis parameter">')
    // Right axis dropdown
    const rightSelect = $('<select id="chartSelectRight" title="Right Y-axis parameter">')

    _cachedGroupNames.forEach((name) => {
        leftSelect.append(
            $('<option>').val(name).text(name).prop('selected', name === selected[0])
        )
        rightSelect.append(
            $('<option>').val(name).text(name).prop('selected', name === selected[1])
        )
    })

    container.append(
        $('<label class="chartSelectorLabel">').text('L:').append(leftSelect),
        $('<label class="chartSelectorLabel">').text('R:').append(rightSelect)
    )

    // Re-render when user changes selection
    leftSelect.on('change', onSelectorChange)
    rightSelect.on('change', onSelectorChange)
}

/**
 * Handler for when user changes a parameter dropdown.
 */
function onSelectorChange() {
    const leftVal = $('#chartSelectLeft').val()
    const rightVal = $('#chartSelectRight').val()
    renderWithSelection([leftVal, rightVal])
}

/**
 * Render the chart with only the selected group names.
 *
 * @param {Array} selectedNames - Array of 1 or 2 group names to plot
 */
function renderWithSelection(selectedNames) {
    const datasets = []

    selectedNames.forEach((groupName, gi) => {
        const groupFeatures = _cachedGroups[groupName]
        if (!groupFeatures) return

        const color = SERIES_COLORS[gi % SERIES_COLORS.length]

        const dataPoints = groupFeatures
            .map((f) => ({
                x: parseAxisValue(f.properties[_cachedXProp], _cachedXType),
                y: parseFloat(f.properties[_cachedYProp]),
            }))
            .filter((d) => d.x != null && !isNaN(d.y))
            .sort((a, b) => (a.x > b.x ? 1 : -1))

        // Auto-detect units from first feature in this group
        const unitLabel =
            groupFeatures[0].properties.units_of_measure || groupName

        datasets.push({
            label: groupName,
            data: dataPoints,
            borderColor: color,
            backgroundColor: color + '33',
            pointBackgroundColor: color,
            tension: 0,
            fill: false,
            pointRadius: 4,
            pointHoverRadius: 6,
            yAxisID: gi === 0 ? 'y' : 'y1',
            _unitLabel: unitLabel, // custom field for axis labeling
        })
    })

    // Use unit labels from each dataset for the Y-axis titles
    const yLabelLeft = datasets[0] ? datasets[0]._unitLabel : 'Value'
    const yLabelRight = datasets[1] ? datasets[1]._unitLabel : ''

    renderChart(datasets, _cachedXLabel, _cachedXType, yLabelLeft, yLabelRight)
}

/**
 * Build Chart.js-compatible datasets for ungrouped data (no groupBy).
 *
 * @param {Array} features - Array of GeoJSON features
 * @param {Array} yAxes - Array of {prop, label, units}
 * @returns {Array} Chart.js datasets
 */
function buildDatasets(features, yAxes) {
    const datasets = []

    yAxes.forEach((yAxisConfig, yi) => {
        const yProp = yAxisConfig.prop || 'value'
        const color = SERIES_COLORS[yi % SERIES_COLORS.length]

        const dataPoints = features
            .map((f) => ({
                x: parseAxisValue(f.properties[_cachedXProp], _cachedXType),
                y: parseFloat(f.properties[yProp]),
            }))
            .filter((d) => d.x != null && !isNaN(d.y))
            .sort((a, b) => (a.x > b.x ? 1 : -1))

        datasets.push({
            label: yAxisConfig.label || yProp,
            data: dataPoints,
            borderColor: color,
            backgroundColor: color + '33',
            pointBackgroundColor: color,
            tension: 0,
            fill: false,
            pointRadius: 4,
            pointHoverRadius: 6,
            yAxisID: yi === 0 ? 'y' : 'y1',
        })
    })

    return datasets
}

/**
 * Parse a raw property value into a chart-compatible axis value.
 */
function parseAxisValue(raw, type) {
    if (raw == null) return null
    if (type === 'time') {
        const d = new Date(raw)
        return isNaN(d.getTime()) ? null : d.getTime()
    }
    const n = parseFloat(raw)
    return isNaN(n) ? null : n
}

/**
 * Render (or re-render) the Chart.js chart.
 */
function renderChart(datasets, xLabel, xType, yLabel, yLabelRight) {
    destroyChart()

    const content = $('#chartToolContent')
    content.empty()
    content.html('<canvas id="chartToolCanvas"></canvas>')

    const ctx = document.getElementById('chartToolCanvas')
    if (!ctx) return

    const hasSecondY = datasets.some((d) => d.yAxisID === 'y1')

    const scales = {
        x: {
            type: 'linear',
            title: { display: true, text: xLabel, color: '#aaa' },
            ticks: {
                color: '#999',
                callback: function (value) {
                    if (xType === 'time') {
                        const d = new Date(value)
                        return d.getFullYear()
                    }
                    return value
                },
            },
            grid: { color: 'rgba(255,255,255,0.07)' },
        },
        y: {
            type: 'linear',
            position: 'left',
            title: { display: true, text: yLabel, color: '#aaa' },
            ticks: { color: '#999' },
            grid: { color: 'rgba(255,255,255,0.07)' },
        },
    }

    if (hasSecondY) {
        scales.y1 = {
            type: 'linear',
            position: 'right',
            title: {
                display: true,
                text: yLabelRight || datasets.find((d) => d.yAxisID === 'y1')?.label || '',
                color: '#aaa',
            },
            ticks: { color: '#999' },
            grid: { drawOnChartArea: false },
        }
    }

    _chartInstance = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    display: true,
                    labels: { color: '#ccc', boxWidth: 12 },
                },
                tooltip: {
                    backgroundColor: 'rgba(0,0,0,0.8)',
                    titleColor: '#fff',
                    bodyColor: '#ddd',
                    callbacks: {
                        title: function (items) {
                            if (xType === 'time' && items[0]) {
                                const d = new Date(items[0].parsed.x)
                                return d.toISOString().split('T')[0]
                            }
                            return items[0]?.label || ''
                        },
                    },
                },
            },
            scales,
        },
    })
}

/**
 * Show loading spinner in the chart area.
 */
function showLoading() {
    destroyChart()
    $('#chartToolContent').html(
        '<div id="chartToolLoading"><div class="spinner"></div>Loading data...</div>'
    )
}

/**
 * Show an error message in the chart area.
 */
function showError(msg) {
    destroyChart()
    $('#chartToolContent').html(`<div id="chartToolError">${msg}</div>`)
}

/**
 * Show an empty-state message in the chart area.
 */
function showEmpty(msg) {
    destroyChart()
    $('#chartToolContent').html(`<div id="chartToolEmpty">${msg}</div>`)
}

export default ChartTool
