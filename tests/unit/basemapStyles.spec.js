import { describe, test, expect, vi, afterEach } from 'vitest'
import { MAP_ENGINE } from '../../src/essence/Basics/MapEngines/types/engine.ts'
import {
    resolveBasemapStyles,
    resolveInitialBasemap,
} from '../../src/essence/Basics/Map_/basemapStyles'

// The basemap list a mission offers, and which entry is active when the map
// first paints: the configured style, or the one a deep link names.

const names = (styles) => styles.map((s) => s.name)

describe('resolveBasemapStyles', () => {
    test('offers the mapbox defaults for a mapbox provider', () => {
        const styles = resolveBasemapStyles({ provider: 'mapbox' }, MAP_ENGINE.DECKGL)

        expect(names(styles)).toEqual(['Streets', 'Satellite', 'Outdoors', 'Light', 'Dark'])
    })

    test('offers GL styles to deck.gl and raster templates to Leaflet for maplibre', () => {
        expect(names(resolveBasemapStyles({ provider: 'maplibre' }, MAP_ENGINE.DECKGL))).toEqual([
            'Streets',
            'Light',
            'Dark',
        ])
        expect(names(resolveBasemapStyles({ provider: 'maplibre' }, MAP_ENGINE.LEAFLET))).toEqual([
            'Streets',
            'Light',
            'Dark',
            'Terrain',
        ])
    })

    test('offers the configured styles as a copy when the mission lists any', () => {
        const configured = [{ name: 'Mine', style: 'https://x/style.json' }]

        const styles = resolveBasemapStyles(
            { provider: 'maplibre', styles: configured },
            MAP_ENGINE.DECKGL
        )

        expect(styles).toEqual(configured)
        expect(styles).not.toBe(configured)
    })
})

describe('resolveInitialBasemap', () => {
    let warn

    afterEach(() => {
        warn?.mockRestore()
    })

    const mapbox = (style) => ({ provider: 'mapbox', style })

    test('activates the configured style when it is in the list', () => {
        const { styles, activeIndex } = resolveInitialBasemap(
            mapbox('mapbox://styles/mapbox/light-v11'),
            MAP_ENGINE.DECKGL
        )

        expect(styles[activeIndex].name).toBe('Light')
    })

    test('lists a configured style outside the defaults as Default, and activates it', () => {
        const { styles, activeIndex } = resolveInitialBasemap(
            mapbox('mapbox://styles/someone/custom'),
            MAP_ENGINE.DECKGL
        )

        expect(activeIndex).toBe(0)
        expect(styles[0]).toEqual({ name: 'Default', style: 'mapbox://styles/someone/custom' })
        expect(styles).toHaveLength(6)
    })

    test('activates the first style when none is configured', () => {
        const { activeIndex } = resolveInitialBasemap({ provider: 'mapbox' }, MAP_ENGINE.DECKGL)

        expect(activeIndex).toBe(0)
    })

    test('activates the style a deep link names', () => {
        const { styles, activeIndex } = resolveInitialBasemap(
            mapbox('mapbox://styles/mapbox/streets-v12'),
            MAP_ENGINE.DECKGL,
            'Dark'
        )

        expect(styles[activeIndex].name).toBe('Dark')
    })

    test('keeps the configured style, with a warning, for a name no style has', () => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

        const { styles, activeIndex } = resolveInitialBasemap(
            mapbox('mapbox://styles/mapbox/streets-v12'),
            MAP_ENGINE.DECKGL,
            'Nope'
        )

        expect(styles[activeIndex].name).toBe('Streets')
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('"Nope"'))
    })

    test('treats an empty or missing name as no request', () => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const config = mapbox('mapbox://styles/mapbox/outdoors-v12')

        expect(resolveInitialBasemap(config, MAP_ENGINE.DECKGL, '').activeIndex).toBe(2)
        expect(resolveInitialBasemap(config, MAP_ENGINE.DECKGL, undefined).activeIndex).toBe(2)
        expect(warn).not.toHaveBeenCalled()
    })
})
