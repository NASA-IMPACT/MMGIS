import Chart from 'chart.js/auto'
import './ChartComponent.css'

const SERIES_COLORS = [
    '#4fc3f7', '#81c784', '#ffb74d', '#e57373',
    '#ba68c8', '#4dd0e1', '#fff176', '#f06292',
    '#aed581', '#90a4ae',
]

const BASE_MARKUP = [
    "<div class='chart-tool'>",
    "  <div class='chart-header'>",
    "    <div class='chart-title'>Time series chart for</div>",
    "    <div class='chart-name'></div>",
    "    <div class='chart-selectors'></div>",
    "  </div>",
    "  <div class='chart-content'>",
    "    <div class='chart-empty'>Click a feature to view its timeseries chart.</div>",
    "  </div>",
    "</div>",
].join('\n')

class ChartComponent {
    /**
     * @param {HTMLElement} container - DOM node that this component fully owns.
     *   The component will clear and rewrite its innerHTML.
     */
    constructor(container) {
        this._container = container
        this._container.innerHTML = BASE_MARKUP

        // Stable refs — grabbed once, never re-queried
        this._nameEl = this._container.querySelector('.chart-name')
        this._selectorsEl = this._container.querySelector('.chart-selectors')
        this._contentEl = this._container.querySelector('.chart-content')

        // Chart.js instance
        this._chartInstance = null

        // Cached state that persists between selector changes
        this._cachedGroups = {}
        this._cachedGroupNames = []
        this._cachedXProp = 'datetime'
        this._cachedXType = 'time'
        this._cachedXLabel = 'Date'
        this._cachedYProp = 'value'

        // Bound so `this` is correct inside the event listener
        this._onSelectorChange = this._onSelectorChange.bind(this)
    }

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /**
     * Render the chart for a given config + pre-fetched feature array.
     *
     * @param {object} config
     * @param {string}  [config.title]          - Already-resolved display title
     * @param {object}  [config.xAxis]
     * @param {string}  [config.xAxis.prop]     - Feature property for X values (default: 'datetime')
     * @param {string}  [config.xAxis.type]     - 'time' | 'linear'             (default: 'time')
     * @param {string}  [config.xAxis.label]    - Axis display label             (default: 'Date')
     * @param {Array}   [config.yAxis]          - Array of {prop, label?, units?}
     * @param {string}  [config.groupBy]        - Feature property to split into named series
     * @param {object[]} features - GeoJSON features with properties
     */
    render(config, features) {
        this._nameEl.textContent = config.title || ''

        // Parse axis config into cached state so selector changes can re-render
        this._cachedXProp = (config.xAxis && config.xAxis.prop) || 'datetime'
        this._cachedXType = (config.xAxis && config.xAxis.type) || 'time'
        this._cachedXLabel = (config.xAxis && config.xAxis.label) || 'Date'

        const yAxes = config.yAxis || [{ prop: 'value' }]
        this._cachedYProp = yAxes[0].prop || 'value'

        const groupByProp = config.groupBy || null

        if (groupByProp) {
            // Build groups keyed by the groupBy property value
            this._cachedGroups = {}
            features.forEach((f) => {
                const groupVal = f.properties[groupByProp] || 'Unknown'
                if (!this._cachedGroups[groupVal]) this._cachedGroups[groupVal] = []
                this._cachedGroups[groupVal].push(f)
            })
            this._cachedGroupNames = Object.keys(this._cachedGroups).sort()

            const selected = this._cachedGroupNames.slice(0, 2)

            if (this._cachedGroupNames.length > 2) {
                this._buildSelectors(selected)
            } else {
                this._selectorsEl.innerHTML = ''
            }

            this._renderWithSelection(selected)
        } else {
            this._cachedGroups = {}
            this._cachedGroupNames = []
            this._selectorsEl.innerHTML = ''

            const datasets = this._buildDatasets(features, yAxes)
            const yLabel =
                (yAxes[0] && yAxes[0].label) ||
                (yAxes[0] && yAxes[0].units) ||
                (features[0] && features[0].properties.units_of_measure) ||
                'Value'
            this._renderChart(datasets, this._cachedXLabel, this._cachedXType, yLabel)
        }
    }

    /**
     * Show a loading spinner. Call this before the data fetch starts.
     */
    showLoading() {
        this._destroyChart()
        this._contentEl.innerHTML =
            '<div class="chart-loading"><div class="chart-spinner"></div>Loading data...</div>'
    }

    /**
     * Show an error message. Call this when the fetch fails.
     * @param {string} message
     */
    showError(message) {
        this._destroyChart()
        this._contentEl.innerHTML = `<div class="chart-error">${message}</div>`
    }

    /**
     * Show an empty-state message. Call this when fetch succeeds but returns no features.
     * @param {string} message
     */
    showEmpty(message) {
        this._destroyChart()
        this._contentEl.innerHTML = `<div class="chart-empty">${message}</div>`
    }

    /**
     * Tear down the Chart.js instance and clear the container.
     */
    destroy() {
        this._destroyChart()
        this._container.innerHTML = ''
    }

    // -------------------------------------------------------------------------
    // Private methods
    // -------------------------------------------------------------------------

    _destroyChart() {
        if (this._chartInstance) {
            this._chartInstance.destroy()
            this._chartInstance = null
        }
    }

    _renderWithSelection(selectedNames) {
        const datasets = []

        selectedNames.forEach((groupName, gi) => {
            const groupFeatures = this._cachedGroups[groupName]
            if (!groupFeatures) return

            const color = SERIES_COLORS[gi % SERIES_COLORS.length]

            const dataPoints = groupFeatures
                .map((f) => ({
                    x: this._parseAxisValue(f.properties[this._cachedXProp], this._cachedXType),
                    y: parseFloat(f.properties[this._cachedYProp]),
                }))
                .filter((d) => d.x != null && !isNaN(d.y))
                .sort((a, b) => (a.x > b.x ? 1 : -1))

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
                _unitLabel: unitLabel,
            })
        })

        const yLabelLeft = datasets[0] ? datasets[0]._unitLabel : 'Value'
        const yLabelRight = datasets[1] ? datasets[1]._unitLabel : ''

        this._renderChart(datasets, this._cachedXLabel, this._cachedXType, yLabelLeft, yLabelRight)
    }

    _buildDatasets(features, yAxes) {
        const datasets = []

        yAxes.forEach((yAxisConfig, yi) => {
            const yProp = yAxisConfig.prop || 'value'
            const color = SERIES_COLORS[yi % SERIES_COLORS.length]

            const dataPoints = features
                .map((f) => ({
                    x: this._parseAxisValue(f.properties[this._cachedXProp], this._cachedXType),
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

    _buildSelectors(selected) {
        this._selectorsEl.innerHTML = ''

        const leftSelect = document.createElement('select')
        leftSelect.className = 'chart-select-left'
        leftSelect.title = 'Left Y-axis parameter'

        const rightSelect = document.createElement('select')
        rightSelect.className = 'chart-select-right'
        rightSelect.title = 'Right Y-axis parameter'

        this._cachedGroupNames.forEach((name) => {
            const leftOpt = document.createElement('option')
            leftOpt.value = name
            leftOpt.textContent = name
            leftOpt.selected = name === selected[0]
            leftSelect.appendChild(leftOpt)

            const rightOpt = document.createElement('option')
            rightOpt.value = name
            rightOpt.textContent = name
            rightOpt.selected = name === selected[1]
            rightSelect.appendChild(rightOpt)
        })

        const leftLabel = document.createElement('label')
        leftLabel.className = 'chart-selector-label'
        leftLabel.textContent = 'L:'
        leftLabel.appendChild(leftSelect)

        const rightLabel = document.createElement('label')
        rightLabel.className = 'chart-selector-label'
        rightLabel.textContent = 'R:'
        rightLabel.appendChild(rightSelect)

        this._selectorsEl.appendChild(leftLabel)
        this._selectorsEl.appendChild(rightLabel)

        leftSelect.addEventListener('change', this._onSelectorChange)
        rightSelect.addEventListener('change', this._onSelectorChange)
    }

    _onSelectorChange() {
        const leftVal = this._selectorsEl.querySelector('.chart-select-left').value
        const rightVal = this._selectorsEl.querySelector('.chart-select-right').value
        this._renderWithSelection([leftVal, rightVal])
    }

    _parseAxisValue(raw, type) {
        if (raw == null) return null
        if (type === 'time') {
            const d = new Date(raw)
            return isNaN(d.getTime()) ? null : d.getTime()
        }
        const n = parseFloat(raw)
        return isNaN(n) ? null : n
    }

    _renderChart(datasets, xLabel, xType, yLabel, yLabelRight) {
        this._destroyChart()

        this._contentEl.innerHTML = '<canvas class="chart-canvas"></canvas>'
        const ctx = this._contentEl.querySelector('.chart-canvas')
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
                            return new Date(value).getFullYear()
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

        this._chartInstance = new Chart(ctx, {
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
                                    return new Date(items[0].parsed.x)
                                        .toISOString()
                                        .split('T')[0]
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
}

export default ChartComponent
