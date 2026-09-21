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
                title: 'site_name',
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

    LAYER_CONFIGS.basemapLabels.variables.featurePopup = { title: 'site_name' }
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
