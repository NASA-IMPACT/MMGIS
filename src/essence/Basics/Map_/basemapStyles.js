import { MAP_ENGINE } from '../MapEngines/types/engine'

const MAPBOX_DEFAULTS = [
    { name: 'Streets', style: 'mapbox://styles/mapbox/streets-v12' },
    { name: 'Satellite', style: 'mapbox://styles/mapbox/satellite-streets-v12' },
    { name: 'Outdoors', style: 'mapbox://styles/mapbox/outdoors-v12' },
    { name: 'Light', style: 'mapbox://styles/mapbox/light-v11' },
    { name: 'Dark', style: 'mapbox://styles/mapbox/dark-v11' },
]

const MAPLIBRE_DEFAULTS_DECKGL = [
    { name: 'Streets', style: 'https://tiles.openfreemap.org/styles/liberty' },
    { name: 'Light', style: 'https://tiles.openfreemap.org/styles/positron' },
    { name: 'Dark', style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json' },
]

const MAPLIBRE_DEFAULTS_LEAFLET = [
    { name: 'Streets', style: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png' },
    { name: 'Light', style: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png' },
    { name: 'Dark', style: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png' },
    { name: 'Terrain', style: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png' },
]

export function resolveBasemapStyles(basemapConfig, engineType) {
    const isLeaflet = engineType === MAP_ENGINE.LEAFLET
    const maplibreDefaults = isLeaflet
        ? MAPLIBRE_DEFAULTS_LEAFLET
        : MAPLIBRE_DEFAULTS_DECKGL

    return basemapConfig.styles && basemapConfig.styles.length > 0
        ? [...basemapConfig.styles]
        : basemapConfig.provider === 'mapbox'
          ? [...MAPBOX_DEFAULTS]
          : [...maplibreDefaults]
}

export function resolveInitialBasemap(basemapConfig, engineType, requestedName) {
    const styles = resolveBasemapStyles(basemapConfig, engineType)
    let activeIndex = styles.findIndex((s) => s.style === basemapConfig.style)
    // A configured style outside the resolved list must still be reported
    // (and switchable) as the active basemap.
    if (activeIndex === -1 && basemapConfig.style) {
        styles.unshift({ name: 'Default', style: basemapConfig.style })
        activeIndex = 0
    }
    activeIndex = Math.max(activeIndex, 0)

    if (typeof requestedName === 'string' && requestedName !== '') {
        const requestedIndex = styles.findIndex((s) => s.name === requestedName)
        if (requestedIndex === -1) {
            console.warn(
                `[basemap] No basemap style named "${requestedName}" in the deep link. Using the mission's configured style.`
            )
        } else {
            activeIndex = requestedIndex
        }
    }

    return { styles, activeIndex }
}
