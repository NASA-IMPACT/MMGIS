import { describe, test, expect, vi } from 'vitest'
import { resolveFeatureHoverLabel } from '../featureHoverLabel'

const feature = (properties: Record<string, unknown>) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties,
})

// Stands in for Layers_.getLayersChosenNamePropVal, which stitches the
// layer's configured naming properties against the feature.
const namePropVal = vi.fn(() => ({ Name: 'Johnson', State: 'Texas' }))
const deps = { getNamePropVal: namePropVal }

describe('resolveFeatureHoverLabel', () => {
    test('shows every configured property on a vector layer', () => {
        const layers = {
            v: { type: 'GeoJsonLayer', variables: { useKeyAsName: ['name', 'state'] } },
        }
        const label = resolveFeatureHoverLabel(
            { layerId: 'v', feature: feature({ name: 'Johnson' }) },
            layers,
            deps,
        )
        expect(label).toEqual({ Name: 'Johnson', State: 'Texas' })
    })

    test('falls back on an unconfigured vector layer, matching Leaflet', () => {
        const layers = { v: { type: 'GeoJsonLayer' } }
        const label = resolveFeatureHoverLabel(
            { layerId: 'v', feature: feature({ name: 'Johnson' }) },
            layers,
            deps,
        )
        expect(label).toEqual({ Name: 'Johnson', State: 'Texas' })
    })

    test('shows the configured properties on a vector tile layer', () => {
        const layers = {
            t: { type: 'MVTLayer', variables: { useKeyAsName: ['name'] }, style: {} },
        }
        const label = resolveFeatureHoverLabel(
            { layerId: 't', feature: feature({ name: 'Johnson' }) },
            layers,
            deps,
        )
        expect(label).toEqual({ Name: 'Johnson', State: 'Texas' })
    })

    test('keeps the single-property vector tile label when only it is set', () => {
        const layers = { t: { type: 'MVTLayer', style: { vtKey: 'name' } } }
        const label = resolveFeatureHoverLabel(
            { layerId: 't', feature: feature({ name: 'Johnson' }) },
            layers,
            deps,
        )
        expect(label).toBe('name: Johnson')
    })

    test('a vector tile layer configured with nothing stays blank', () => {
        const layers = { t: { type: 'MVTLayer', style: {} } }
        expect(
            resolveFeatureHoverLabel(
                { layerId: 't', feature: feature({ name: 'Johnson' }) },
                layers,
                deps,
            ),
        ).toBeNull()
    })

    test('a vector tile feature lacking the single configured property stays blank', () => {
        const layers = { t: { type: 'MVTLayer', style: { vtKey: 'name' } } }
        expect(
            resolveFeatureHoverLabel(
                { layerId: 't', feature: feature({ other: 1 }) },
                layers,
                deps,
            ),
        ).toBeNull()
    })

    test('hovering off every feature clears the label', () => {
        expect(resolveFeatureHoverLabel({ feature: null }, {}, deps)).toBeNull()
    })

    test('a layer the mission does not configure shows nothing', () => {
        expect(
            resolveFeatureHoverLabel(
                { layerId: 'overlay', feature: feature({ name: 'x' }) },
                { v: { type: 'GeoJsonLayer' } },
                deps,
            ),
        ).toBeNull()
    })
})
