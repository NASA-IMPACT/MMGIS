import { test, expect, vi, beforeEach, afterEach } from 'vitest'

import FeaturePopupTool from '../../src/essence/Tools/FeaturePopup/FeaturePopupTool'
import { makeFakeMmgisApi, flushBus } from './helpers/fakeMmgisApi'

/**
 * A layer that opts in, and one beside it that does not. Rebuilt per test:
 * several tests reshape the opted-in layer's config, and the plugin reads it
 * through the bus rather than copying it.
 */
const layerConfigs = () => ({
    craters: {
        name: 'craters',
        type: 'vector',
        variables: {
            featurePopup: {
                enabled: true,
                title: '{site_name}',
                properties: ['depth_m', 'sample_class'],
            },
        },
    },
    basemapLabels: {
        name: 'basemapLabels',
        type: 'vectortile',
        variables: {},
    },
})

const CRATER = {
    type: 'Feature',
    properties: {
        site_name: 'Jezero',
        depth_m: 12,
        sample_class: 'sedimentary',
        internal_id: 'x-91',
    },
    geometry: { type: 'Point', coordinates: [77.5, 18.4] },
}

const CLICK = { lat: 18.4, lng: 77.5 }

/** A pick the engine would report for a click on an opted-in feature. */
const clickOn = (layerId, feature = CRATER) => ({
    feature,
    layerId,
    latlng: CLICK,
    pixel: { x: 10, y: 20 },
})

let api
let LAYER_CONFIGS

async function start() {
    FeaturePopupTool.initialize()
    await flushBus()
    api.reset()
}

beforeEach(() => {
    vi.useFakeTimers()
    api = makeFakeMmgisApi()
    LAYER_CONFIGS = layerConfigs()
    api.requestImpl.set('layers:getAllConfigs', () => LAYER_CONFIGS)
    api.requestImpl.set('map:getEngineType', () => 'deckgl')
    window.mmgisAPI = api
})

/**
 * Boot the way MMGIS does: tools load before Layers_.fina() registers the
 * layer providers, so the plugin starts with nothing to ask.
 */
async function startBeforeLayersLoad() {
    api.unregister('layers:getAllConfigs')
    api.requestImpl.set('map:getEngineType', () => null)
    FeaturePopupTool.initialize()
    await flushBus()
    api.reset()
}

/** Layers_.fina(): the providers appear and the engine becomes readable. */
async function finishLayersLoad(engineType = 'deckgl') {
    api.register('layers:getAllConfigs')
    api.requestImpl.set('map:getEngineType', () => engineType)
    await vi.advanceTimersByTimeAsync(250)
    await flushBus()
}

afterEach(() => {
    FeaturePopupTool.destroy()
    delete window.mmgisAPI
    vi.useRealTimers()
})

test('shows a card for a click on a layer that opted in', async () => {
    await start()

    api.emit('map:featureClick', clickOn('craters'))
    await flushBus()

    expect(api.namesOf('map:showPopup')).toHaveLength(1)
    expect(api.namesOf('map:showPopup')[0].payload).toMatchObject({
        latlng: CLICK,
        title: 'Jezero',
    })
})

test('lists the configured properties, and leaves the rest off', async () => {
    await start()

    api.emit('map:featureClick', clickOn('craters'))
    await flushBus()

    const { html } = api.namesOf('map:showPopup')[0].payload
    expect(html).toContain('depth_m')
    expect(html).toContain('12')
    expect(html).toContain('sample_class')
    expect(html).toContain('sedimentary')
    expect(html).not.toContain('internal_id')
})

test('shows nothing for a pick that reports a layer but no feature', async () => {
    await start()

    api.emit('map:featureClick', { feature: null, layerId: 'craters', latlng: CLICK })
    await flushBus()

    expect(api.namesOf('map:showPopup')).toHaveLength(0)
})

test('escapes a property value that holds markup', async () => {
    await start()

    api.emit('map:featureClick', clickOn('craters', {
        ...CRATER,
        properties: { ...CRATER.properties, sample_class: '<img src=x onerror=alert(1)>' },
    }))
    await flushBus()

    const { html } = api.namesOf('map:showPopup')[0].payload
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
})

test('falls back to the layer name property when no popup title is configured', async () => {
    LAYER_CONFIGS.craters.variables.useKeyAsName = 'sample_class'
    delete LAYER_CONFIGS.craters.variables.featurePopup.title
    await start()

    api.emit('map:featureClick', clickOn('craters'))
    await flushBus()

    expect(api.namesOf('map:showPopup')[0].payload.title).toBe('sedimentary')
})

test('shows a card with no title when neither is configured', async () => {
    delete LAYER_CONFIGS.craters.variables.featurePopup.title
    await start()

    api.emit('map:featureClick', clickOn('craters'))
    await flushBus()

    const { title, html } = api.namesOf('map:showPopup')[0].payload
    expect(title).toBeUndefined()
    expect(html).toContain('depth_m')
})

test('takes the first entry when the layer names features with a list', async () => {
    LAYER_CONFIGS.craters.variables.useKeyAsName = ['sample_class', 'depth_m']
    delete LAYER_CONFIGS.craters.variables.featurePopup.title
    await start()

    api.emit('map:featureClick', clickOn('craters'))
    await flushBus()

    expect(api.namesOf('map:showPopup')[0].payload.title).toBe('sedimentary')
})

/** Give the opted-in layer the actions a mission would declare. */
function withActions(...actions) {
    LAYER_CONFIGS.craters.variables.featurePopup.actions = actions
}

test('puts the configured actions on the card', async () => {
    withActions(
        { label: 'Analyze feature', event: 'analyzeFeature' },
        { label: 'Add to selection', event: 'addToSelection' }
    )
    await start()

    api.emit('map:featureClick', clickOn('craters'))
    await flushBus()

    expect(api.namesOf('map:showPopup')[0].payload).toMatchObject({
        primaryAction: { label: 'Analyze feature' },
        secondaryAction: { label: 'Add to selection' },
    })
})

test('emits the action event, with the feature that was clicked', async () => {
    withActions({ label: 'Analyze feature', event: 'analyzeFeature' })
    await start()

    api.emit('map:featureClick', clickOn('craters'))
    await flushBus()
    api.closePopup('primary')
    await flushBus()

    const emitted = api.emitsOf('plugin:feature-popup:analyzeFeature')
    expect(emitted).toHaveLength(1)
    expect(emitted[0].data).toEqual({
        feature: CRATER,
        layerId: 'craters',
        latlng: CLICK,
    })
})

test('emits nothing when the card is dismissed or replaced', async () => {
    withActions({ label: 'Analyze feature', event: 'analyzeFeature' })
    await start()

    api.emit('map:featureClick', clickOn('craters'))
    await flushBus()
    api.closePopup('dismiss')
    await flushBus()

    expect(api.emitsOf('plugin:feature-popup:analyzeFeature')).toHaveLength(0)
})

test('drops a third action, which the card has no slot for', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    withActions(
        { label: 'One', event: 'one' },
        { label: 'Two', event: 'two' },
        { label: 'Three', event: 'three' }
    )
    await start()

    api.emit('map:featureClick', clickOn('craters'))
    await flushBus()

    const payload = api.namesOf('map:showPopup')[0].payload
    expect(payload.primaryAction).toEqual({ label: 'One' })
    expect(payload.secondaryAction).toEqual({ label: 'Two' })
    expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('craters')
    )
})

test('stays out of the way on Leaflet, which has its own feature click path', async () => {
    api.requestImpl.set('map:getEngineType', () => 'leaflet')
    await start()

    api.emit('map:featureClick', clickOn('craters'))
    await flushBus()

    expect(api.namesOf('map:showPopup')).toHaveLength(0)
})

test('picks up a layer that opts in after the mission has loaded', async () => {
    await start()

    LAYER_CONFIGS.basemapLabels.variables.featurePopup = {
        enabled: true,
        title: '{site_name}',
    }
    api.emit('layers:listChanged')
    await flushBus()
    api.emit('map:featureClick', clickOn('basemapLabels'))
    await flushBus()

    expect(api.namesOf('map:showPopup')).toHaveLength(1)
})

test('shows nothing more once destroyed, and takes its card down', async () => {
    await start()
    api.emit('map:featureClick', clickOn('craters'))
    await flushBus()
    api.reset()

    FeaturePopupTool.destroy()
    await flushBus()
    expect(api.namesOf('map:hidePopup')).toHaveLength(1)

    api.emit('map:featureClick', clickOn('craters'))
    await flushBus()
    expect(api.namesOf('map:showPopup')).toHaveLength(0)
})

test('warns and shows nothing when the layer configs cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    api.requestImpl.set('layers:getAllConfigs', () => {
        throw new Error('bus is down')
    })
    await start()

    api.emit('map:featureClick', clickOn('craters'))
    await flushBus()

    expect(api.namesOf('map:showPopup')).toHaveLength(0)
    expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('[FeaturePopup]'),
        expect.anything()
    )
})

test('shows one card when the controller both initializes and makes the tool', async () => {
    // ToolControllerModern_ calls initialize() and then make(); initialize()
    // is itself a make() for a plugin with no panel to render.
    FeaturePopupTool.initialize()
    FeaturePopupTool.make(null)
    await flushBus()
    api.reset()

    api.emit('map:featureClick', clickOn('craters'))
    await flushBus()

    expect(api.namesOf('map:showPopup')).toHaveLength(1)
})

test('reads the title as a template, so a mission can write text around a property', async () => {
    LAYER_CONFIGS.craters.variables.featurePopup.title = 'Crater {site_name} ({depth_m} m)'
    await start()

    api.emit('map:featureClick', clickOn('craters'))
    await flushBus()

    expect(api.namesOf('map:showPopup')[0].payload.title).toBe('Crater Jezero (12 m)')
})

test('shows a constant title with no property in it', async () => {
    LAYER_CONFIGS.craters.variables.featurePopup.title = 'Sample site'
    await start()

    api.emit('map:featureClick', clickOn('craters'))
    await flushBus()

    expect(api.namesOf('map:showPopup')[0].payload.title).toBe('Sample site')
})

test('shows no heading when the template resolves to nothing', async () => {
    LAYER_CONFIGS.craters.variables.featurePopup.title = '{absent_property}'
    await start()

    api.emit('map:featureClick', clickOn('craters'))
    await flushBus()

    expect(api.namesOf('map:showPopup')[0].payload.title).toBeUndefined()
})

test('shows nothing for a layer whose popup is switched off', async () => {
    LAYER_CONFIGS.craters.variables.featurePopup.enabled = false
    await start()

    api.emit('map:featureClick', clickOn('craters'))
    await flushBus()

    expect(api.namesOf('map:showPopup')).toHaveLength(0)
})

test('waits for the layer providers, which register after tools load', async () => {
    await startBeforeLayersLoad()

    api.emit('map:featureClick', clickOn('craters'))
    await flushBus()
    expect(api.namesOf('map:showPopup')).toHaveLength(0)

    await finishLayersLoad()
    api.emit('map:featureClick', clickOn('craters'))
    await flushBus()

    expect(api.namesOf('map:showPopup')).toHaveLength(1)
})

test('gates on the engine once there is one to read', async () => {
    await startBeforeLayersLoad()
    await finishLayersLoad('leaflet')

    api.emit('map:featureClick', clickOn('craters'))
    await flushBus()

    expect(api.namesOf('map:showPopup')).toHaveLength(0)
})

test('takes the open card down when the next feature has nothing to show', async () => {
    LAYER_CONFIGS.craters.variables.featurePopup.properties = ['depth_m']
    delete LAYER_CONFIGS.craters.variables.featurePopup.title
    await start()

    api.emit('map:featureClick', clickOn('craters'))
    await flushBus()
    expect(api.hasOpenPopup()).toBe(true)
    api.reset()

    // A feature of the same layer carrying none of the configured properties.
    api.emit('map:featureClick', clickOn('craters', {
        ...CRATER,
        properties: { internal_id: 'x-92' },
    }))
    await flushBus()

    expect(api.namesOf('map:showPopup')).toHaveLength(0)
    expect(api.namesOf('map:hidePopup')).toHaveLength(1)
    expect(api.hasOpenPopup()).toBe(false)
})

test('leaves a layer out when the switch was never turned on', async () => {
    // An admin who fills a field but never ticks the box: Maker writes the
    // key it touched and nothing else.
    LAYER_CONFIGS.basemapLabels.variables.featurePopup = { title: 'Labels' }
    await start()

    api.emit('map:featureClick', clickOn('basemapLabels'))
    await flushBus()

    expect(api.namesOf('map:showPopup')).toHaveLength(0)
})

test("leaves another plugin's card alone when torn down with none of its own", async () => {
    await start()

    FeaturePopupTool.destroy()
    await flushBus()

    expect(api.namesOf('map:hidePopup')).toHaveLength(0)
})

test('finishes teardown when an unsubscribe throws', async () => {
    await start()
    FeaturePopupTool._cleanups.unshift(() => {
        throw new Error('bad unsubscribe')
    })

    FeaturePopupTool.destroy()
    await flushBus()

    expect(FeaturePopupTool.made).toBe(false)
    api.emit('map:featureClick', clickOn('craters'))
    await flushBus()
    expect(api.namesOf('map:showPopup')).toHaveLength(0)
})

test('leaves out a property that is null and renders an object value readably', async () => {
    delete LAYER_CONFIGS.craters.variables.featurePopup.properties
    await start()

    api.emit('map:featureClick', clickOn('craters', {
        ...CRATER,
        properties: { site_name: 'Jezero', retired: null, extent: { w: 2 } },
    }))
    await flushBus()

    const { html } = api.namesOf('map:showPopup')[0].payload
    expect(html).not.toContain('retired')
    expect(html).not.toContain('[object Object]')
    // Escaped, as every value the card renders is.
    expect(html).toContain('{&quot;w&quot;:2}')
})

test('drops an action whose event name is blank, and says so', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    withActions({ label: 'Go', event: '   ' }, { label: 'Fine', event: 'fine' })
    await start()

    api.emit('map:featureClick', clickOn('craters'))
    await flushBus()

    const payload = api.namesOf('map:showPopup')[0].payload
    expect(payload.primaryAction).toEqual({ label: 'Fine' })
    expect(payload.secondaryAction).toBeUndefined()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('craters'))
})

test('resolves a nested property in the title template', async () => {
    LAYER_CONFIGS.craters.variables.featurePopup.title = 'Crater {site.name}'
    await start()

    api.emit('map:featureClick', clickOn('craters', {
        ...CRATER,
        properties: { site: { name: 'Jezero' } },
    }))
    await flushBus()

    expect(api.namesOf('map:showPopup')[0].payload.title).toBe('Crater Jezero')
})

test('names a feature by a numeric property, which the service would refuse raw', async () => {
    LAYER_CONFIGS.craters.variables.useKeyAsName = 'sol'
    delete LAYER_CONFIGS.craters.variables.featurePopup.title
    await start()

    api.emit('map:featureClick', clickOn('craters', {
        ...CRATER,
        properties: { ...CRATER.properties, sol: 412 },
    }))
    await flushBus()

    expect(api.namesOf('map:showPopup')).toHaveLength(1)
    expect(api.namesOf('map:showPopup')[0].payload.title).toBe('412')
})

test('shows the card without a heading when the naming property is blank', async () => {
    LAYER_CONFIGS.craters.variables.useKeyAsName = 'site_name'
    delete LAYER_CONFIGS.craters.variables.featurePopup.title
    await start()

    api.emit('map:featureClick', clickOn('craters', {
        ...CRATER,
        properties: { ...CRATER.properties, site_name: '   ' },
    }))
    await flushBus()

    const payload = api.namesOf('map:showPopup')[0].payload
    expect(payload.title).toBeUndefined()
    expect(payload.html).toContain('depth_m')
})

test('lists every configured property when the keys arrive with spaces', async () => {
    // Configure's textarray splits on ',' without trimming, so this is what a
    // mission typing 'depth_m, sample_class' actually stores.
    LAYER_CONFIGS.craters.variables.featurePopup.properties = ['depth_m', ' sample_class']
    await start()

    api.emit('map:featureClick', clickOn('craters'))
    await flushBus()

    const { html } = api.namesOf('map:showPopup')[0].payload
    expect(html).toContain('depth_m')
    expect(html).toContain('sample_class')
    expect(html).toContain('sedimentary')
})

test('lists a nested property by the dot path the heading already accepts', async () => {
    LAYER_CONFIGS.craters.variables.featurePopup.properties = ['site.name']
    await start()

    api.emit('map:featureClick', clickOn('craters', {
        ...CRATER,
        properties: { site: { name: 'Nili' } },
    }))
    await flushBus()

    const { html } = api.namesOf('map:showPopup')[0].payload
    expect(html).toContain('site.name')
    expect(html).toContain('Nili')
})

test('prefers a property whose own name contains a dot over a nested path', async () => {
    LAYER_CONFIGS.craters.variables.featurePopup.properties = ['site.name']
    await start()

    api.emit('map:featureClick', clickOn('craters', {
        ...CRATER,
        properties: { 'site.name': 'Flat', site: { name: 'Nested' } },
    }))
    await flushBus()

    const { html } = api.namesOf('map:showPopup')[0].payload
    expect(html).toContain('Flat')
    expect(html).not.toContain('Nested')
})

test('emits a fully qualified event exactly as the mission wrote it', async () => {
    withActions({ label: 'Analyze', event: 'plugin:aoi:analyzeFeature' })
    await start()

    api.emit('map:featureClick', clickOn('craters'))
    await flushBus()
    api.closePopup('primary')
    await flushBus()

    expect(api.emitsOf('plugin:aoi:analyzeFeature')).toHaveLength(1)
    expect(api.emitsOf('plugin:aoi:analyzeFeature')[0].data).toEqual({
        feature: CRATER,
        layerId: 'craters',
        latlng: CLICK,
    })
    // Not nested under this plugin's own address.
    expect(
        api.emitsOf('plugin:feature-popup:plugin:aoi:analyzeFeature')
    ).toHaveLength(0)
})

test('keeps a bare event name under this plugin, which is whose event it is', async () => {
    withActions({ label: 'Analyze', event: 'analyzeFeature' })
    await start()

    api.emit('map:featureClick', clickOn('craters'))
    await flushBus()
    api.closePopup('primary')
    await flushBus()

    expect(api.emitsOf('plugin:feature-popup:analyzeFeature')).toHaveLength(1)
})

test('takes its card down on a click that lands on nothing', async () => {
    await start()
    api.emit('map:featureClick', clickOn('craters'))
    await flushBus()
    expect(api.hasOpenPopup()).toBe(true)
    api.reset()

    // Empty space: core reports the click with no feature picked.
    api.emit('map:featureClick', { feature: null, latlng: CLICK })
    await flushBus()

    expect(api.namesOf('map:hidePopup')).toHaveLength(1)
    expect(api.hasOpenPopup()).toBe(false)
})

test('takes its card down on a click on a layer that did not opt in', async () => {
    await start()
    api.emit('map:featureClick', clickOn('craters'))
    await flushBus()
    api.reset()

    api.emit('map:featureClick', clickOn('basemapLabels'))
    await flushBus()

    expect(api.namesOf('map:showPopup')).toHaveLength(0)
    expect(api.namesOf('map:hidePopup')).toHaveLength(1)
    expect(api.hasOpenPopup()).toBe(false)
})

test('asks for no hide when it has no card of its own up', async () => {
    await start()

    api.emit('map:featureClick', { feature: null, latlng: CLICK })
    api.emit('map:featureClick', clickOn('basemapLabels'))
    await flushBus()

    expect(api.namesOf('map:hidePopup')).toHaveLength(0)
})
