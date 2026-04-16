import $ from 'jquery'
import L_ from '../../Basics/Layers_/Layers_'
import ChartComponent from './ChartComponent'

const ChartTool = {
    height: 200,
    width: 'full',
    on: false,
    using: null,
    MMGISInterface: null,
    _component: null,

    make: function () {
        this.MMGISInterface = new interfaceWithMMGIS(this)
        this.on = true

        if (this.using != null) {
            fetchAndRender(this.using, this._component)
        }
    },
    use: function (layer) {
        this.using = layer
        if (!this.on) {
            const btn = document.getElementById('toolButtonChart')
            if (btn) btn.click()
        } else {
            fetchAndRender(this.using, this._component)
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

function interfaceWithMMGIS(tool) {
    this.separateFromMMGIS = function () {
        if (tool._component) {
            tool._component.destroy()
            tool._component = null
        }
    }

    const toolsContainer = $('#tools')
    toolsContainer.css('background', 'var(--color-k)')
    toolsContainer.empty()

    const wrapper = $('<div>').css('height', '100%')
    toolsContainer.append(wrapper)

    tool._component = new ChartComponent(wrapper[0])
}

/**
 * Interpolate {prop} placeholders in a URL template using feature properties.
 */
function interpolateUrl(urlTemplate, properties) {
    return urlTemplate.replace(/\{([^}]+)\}/g, (match, key) => {
        const val = properties[key]
        return val != null ? encodeURIComponent(val) : match
    })
}

/**
 * Fetch timeseries data for the clicked layer feature and hand it to the component.
 */
async function fetchAndRender(layer, component) {
    if (!component) return

    const layerName = layer.options.layerName
    const layerData = L_.layers.data[layerName]

    if (!layerData || !layerData.variables || !layerData.variables.chart) {
        component.showError('This layer has no chart configuration.')
        return
    }

    const chartConfig = layerData.variables.chart
    const feature = layer.feature
    const properties = feature.properties

    const idValue = properties.local_site_name || 'Feature'
    const titleTemplate = chartConfig.title || '{id}'
    const titleText = titleTemplate
        .replace(/\{id\}/g, idValue)
        .replace(/\{([^}]+)\}/g, (_, key) =>
            properties[key] != null ? properties[key] : key
        )

    component.showLoading()

    const url = interpolateUrl(chartConfig.timeseriesUrl, properties)

    try {
        const response = await fetch(url)
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }
        const data = await response.json()

        const features = data.features || data.results || []
        if (features.length === 0) {
            component.showEmpty('No timeseries data found for this feature.')
            return
        }

        component.render(
            {
                title: titleText,
                xAxis: chartConfig.xAxis,
                yAxis: chartConfig.yAxis,
                groupBy: chartConfig.groupBy,
            },
            features
        )
    } catch (err) {
        console.error('ChartTool: fetch error', err)
        component.showError(`Failed to load data: ${err.message}`)
    }
}

export default ChartTool
