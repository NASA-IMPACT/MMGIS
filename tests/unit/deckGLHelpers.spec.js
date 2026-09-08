import { test, expect } from 'vitest'
import {
    resolveLatLng,
    resolveBounds,
    resolvePoint,
    resolvePadding,
    resolveLayerId,
    pickInfoToResult,
    buildDeckLayer,
    hexToRgba,
    isImageTileResponse,
} from '../../src/essence/Basics/MapEngines/Adapters/DeckGLHelpers.ts'

const tileResponse = (ok, status, contentType) => ({
    ok,
    status,
    headers: { get: () => contentType },
})

test.describe('DeckGLHelpers', () => {
    test.describe('resolveLatLng', () => {
        test('accepts [lat, lng] tuple', () => {
            expect(resolveLatLng([40, -120])).toEqual({ lat: 40, lng: -120 })
        })

        test('accepts {lat, lng} object', () => {
            expect(resolveLatLng({ lat: 40, lng: -120 })).toEqual({ lat: 40, lng: -120 })
        })
    })

    test.describe('resolveBounds', () => {
        test('accepts [[sw], [ne]] tuple and converts to [[lng, lat], [lng, lat]]', () => {
            const result = resolveBounds([[10, -20], [30, -10]])
            expect(result).toEqual([[-20, 10], [-10, 30]])
        })

        test('accepts {southWest, northEast} object', () => {
            const result = resolveBounds({
                southWest: { lat: 10, lng: -20 },
                northEast: { lat: 30, lng: -10 },
            })
            expect(result).toEqual([[-20, 10], [-10, 30]])
        })
    })

    test.describe('resolvePoint', () => {
        test('accepts [x, y] tuple', () => {
            expect(resolvePoint([100, 200])).toEqual({ x: 100, y: 200 })
        })

        test('accepts {x, y} object', () => {
            expect(resolvePoint({ x: 100, y: 200 })).toEqual({ x: 100, y: 200 })
        })
    })

    test.describe('resolvePadding', () => {
        test('returns 0 when undefined', () => {
            expect(resolvePadding(undefined)).toBe(0)
        })

        test('passes through a number', () => {
            expect(resolvePadding(20)).toBe(20)
        })

        test('converts [top, right, bottom, left] array to object', () => {
            expect(resolvePadding([10, 20, 30, 40])).toEqual({ top: 10, right: 20, bottom: 30, left: 40 })
        })

        test('passes through an object unchanged', () => {
            const pad = { top: 5, right: 10, bottom: 15, left: 20 }
            expect(resolvePadding(pad)).toEqual(pad)
        })
    })

    test.describe('resolveLayerId', () => {
        test('returns a string id as-is', () => {
            expect(resolveLayerId('my-layer')).toBe('my-layer')
        })

        test('extracts id from a layer object', () => {
            expect(resolveLayerId({ id: 'tile-layer-1' })).toBe('tile-layer-1')
        })
    })

    test.describe('pickInfoToResult', () => {
        test('returns {feature: null} when not picked', () => {
            expect(pickInfoToResult({ picked: false })).toEqual({ feature: null })
        })

        test('maps a picked PickingInfo to FeaturePickResult', () => {
            const info = {
                picked: true,
                coordinate: [-120, 40],
                object: { type: 'Feature', properties: { name: 'test' } },
                layer: { id: 'my-layer' },
                x: 100,
                y: 200,
            }
            const result = pickInfoToResult(info)
            expect(result.latlng).toEqual({ lat: 40, lng: -120 })
            expect(result.layerId).toBe('my-layer')
            expect(result.pixel).toEqual({ x: 100, y: 200 })
            expect(result.feature).toEqual(info.object)
        })

        test('handles missing layer id', () => {
            const info = {
                picked: true,
                coordinate: [0, 0],
                object: {},
                x: 0,
                y: 0,
            }
            const result = pickInfoToResult(info)
            expect(result.layerId).toBeUndefined()
        })
    })

    test.describe('isImageTileResponse', () => {
        test('accepts a response carrying image bytes', () => {
            expect(isImageTileResponse(tileResponse(true, 200, 'image/png'))).toBe(true)
            expect(isImageTileResponse(tileResponse(true, 200, 'image/jpeg;charset=binary'))).toBe(true)
            expect(isImageTileResponse(tileResponse(true, 200, 'IMAGE/PNG'))).toBe(true)
        })

        test('rejects an error body served with a 200, as tile servers do for a missing timestamp', () => {
            expect(isImageTileResponse(tileResponse(true, 200, 'text/html'))).toBe(false)
            expect(isImageTileResponse(tileResponse(true, 200, 'application/json'))).toBe(false)
        })

        test('rejects a failed request', () => {
            expect(isImageTileResponse(tileResponse(false, 404, 'image/png'))).toBe(false)
            expect(isImageTileResponse(tileResponse(false, 500, 'text/html'))).toBe(false)
        })

        test('rejects a response with no content type', () => {
            expect(isImageTileResponse(tileResponse(true, 200, null))).toBe(false)
        })
    })

    test.describe('buildDeckLayer', () => {
        test('throws for unsupported layer type', () => {
            expect(() => buildDeckLayer('id', { type: 'unsupported' })).toThrow(
                'buildDeckLayer: unsupported layer type "unsupported"'
            )
        })

        test('error message lists all supported canonical types', () => {
            let msg = ''
            try { buildDeckLayer('id', { type: 'bad' }) } catch (e) { msg = e.message }
            expect(msg).toContain('tile')
            expect(msg).toContain('vector')
            expect(msg).toContain('vectortile')
            expect(msg).toContain('scatterplot')
            expect(msg).toContain('tile3d')
            expect(msg).toContain('pointcloud')
        })

        test('creates a PointCloudLayer for pointcloud type', () => {
            const layer = buildDeckLayer('pc-1', { type: 'pointcloud', url: '/data/cloud.las' })
            expect(layer.id).toBe('pc-1')
        })

        test('creates a PointCloudLayer via PointCloudLayer alias', () => {
            const layer = buildDeckLayer('pc-2', { type: 'PointCloudLayer', url: '/data/cloud.las' })
            expect(layer.id).toBe('pc-2')
        })

        test('creates a TileLayer for tile type', () => {
            const layer = buildDeckLayer('tile-1', {
                type: 'tile',
                url: 'https://example.com/tiles/{z}/{x}/{y}.png',
            })
            expect(layer.id).toBe('tile-1')
        })

        test('creates a TileLayer via TileLayer alias', () => {
            const layer = buildDeckLayer('tile-2', {
                type: 'TileLayer',
                url: 'https://example.com/tiles/{z}/{x}/{y}.png',
            })
            expect(layer.id).toBe('tile-2')
        })

        test.describe('missing tiles', () => {
            const tileLayer = () =>
                buildDeckLayer('tile-missing', {
                    type: 'tile',
                    url: 'https://example.com/tiles/{z}/{x}/{y}.png',
                })

            const tileProps = (data) => ({
                data,
                tile: {
                    index: { z: 1, x: 0, y: 0 },
                    bbox: { west: 0, south: 0, east: 10, north: 10 },
                },
            })

            test('renders nothing for a tile that carried no image', () => {
                const renderSubLayers = tileLayer().props.renderSubLayers
                expect(renderSubLayers(tileProps(null))).toBeNull()
                expect(renderSubLayers(tileProps(undefined))).toBeNull()
            })

            test('renders a BitmapLayer for a tile that decoded', () => {
                const image = { width: 256, height: 256 }
                const sublayer = tileLayer().props.renderSubLayers(tileProps(image))
                expect(sublayer).not.toBeNull()
                expect(sublayer.props.image).toBe(image)
            })

            test('reports tile failures through onTileError', () => {
                expect(typeof tileLayer().props.onTileError).toBe('function')
            })
        })

        test('creates a GeoJsonLayer for vector type', () => {
            const layer = buildDeckLayer('vec-1', {
                type: 'vector',
                geojson: { type: 'FeatureCollection', features: [] },
            })
            expect(layer.id).toBe('vec-1')
        })

        test('creates a GeoJsonLayer via GeoJsonLayer alias', () => {
            const layer = buildDeckLayer('vec-2', {
                type: 'GeoJsonLayer',
                geojson: { type: 'FeatureCollection', features: [] },
            })
            expect(layer.id).toBe('vec-2')
        })

        test('creates an MVTLayer for vectortile type', () => {
            const layer = buildDeckLayer('mvt-1', {
                type: 'vectortile',
                url: 'https://example.com/tiles/{z}/{x}/{y}.mvt',
            })
            expect(layer.id).toBe('mvt-1')
        })

        test('creates an MVTLayer via MVTLayer alias', () => {
            const layer = buildDeckLayer('mvt-2', {
                type: 'MVTLayer',
                url: 'https://example.com/tiles/{z}/{x}/{y}.mvt',
            })
            expect(layer.id).toBe('mvt-2')
        })

        test('gives vectortile points a pixel radius from style.radius', () => {
            const layer = buildDeckLayer('mvt-3', {
                type: 'vectortile',
                url: 'https://example.com/tiles/{z}/{x}/{y}.mvt',
                style: { radius: 5 },
            })
            // Without these, MVT points inherit deck.gl's 1-metre default and
            // render sub-pixel at every practical zoom.
            expect(layer.props.getPointRadius).toBe(5)
            expect(layer.props.pointRadiusUnits).toBe('pixels')
        })

        test('reads vectortile point radius from style.radiusProp', () => {
            const layer = buildDeckLayer('mvt-4', {
                type: 'vectortile',
                url: 'https://example.com/tiles/{z}/{x}/{y}.mvt',
                style: { radius: 5, radiusProp: 'size' },
            })
            expect(layer.props.getPointRadius({ properties: { size: 12 } })).toBe(12)
            // Falls back to style.radius when the feature lacks the property.
            expect(layer.props.getPointRadius({ properties: {} })).toBe(5)
        })

        test('reads vectortile line width from style.weightProp', () => {
            const layer = buildDeckLayer('mvt-5', {
                type: 'vectortile',
                url: 'https://example.com/tiles/{z}/{x}/{y}.mvt',
                style: { weight: 2, weightProp: 'w' },
            })
            expect(layer.props.getLineWidth({ properties: { w: 7 } })).toBe(7)
            expect(layer.props.getLineWidth({ properties: {} })).toBe(2)
        })

        test('reads vectortile fill colour from style.fillColorProp', () => {
            const layer = buildDeckLayer('mvt-6', {
                type: 'vectortile',
                url: 'https://example.com/tiles/{z}/{x}/{y}.mvt',
                style: { fillColor: '#000000', fillOpacity: 1, fillColorProp: 'c' },
            })
            expect(
                layer.props.getFillColor({ properties: { c: '#ff0000' } })
            ).toEqual([255, 0, 0, 255])
            expect(layer.props.getFillColor({ properties: {} })).toEqual([0, 0, 0, 255])
        })

        test('reads vectortile line colour from style.colorProp', () => {
            const layer = buildDeckLayer('mvt-7', {
                type: 'vectortile',
                url: 'https://example.com/tiles/{z}/{x}/{y}.mvt',
                style: { color: '#000000', opacity: 1, colorProp: 'c' },
            })
            expect(
                layer.props.getLineColor({ properties: { c: '#00ff00' } })
            ).toEqual([0, 255, 0, 255])
        })

        test('reads vectortile opacities from their *Prop fields', () => {
            const layer = buildDeckLayer('mvt-8', {
                type: 'vectortile',
                url: 'https://example.com/tiles/{z}/{x}/{y}.mvt',
                style: {
                    fillColor: '#ff0000',
                    fillOpacityProp: 'fo',
                    color: '#0000ff',
                    opacityProp: 'o',
                },
            })
            expect(layer.props.getFillColor({ properties: { fo: 0.5 } })[3]).toBe(128)
            expect(layer.props.getLineColor({ properties: { o: 0.5 } })[3]).toBe(128)
        })

        test('keeps vectortile style accessors static when no *Prop is set', () => {
            const layer = buildDeckLayer('mvt-9', {
                type: 'vectortile',
                url: 'https://example.com/tiles/{z}/{x}/{y}.mvt',
                style: { radius: 5, weight: 2 },
            })
            // Constants, not functions — deck.gl skips per-feature evaluation.
            expect(typeof layer.props.getPointRadius).toBe('number')
            expect(typeof layer.props.getLineWidth).toBe('number')
            expect(Array.isArray(layer.props.getFillColor)).toBe(true)
            expect(Array.isArray(layer.props.getLineColor)).toBe(true)
        })

        // deck.gl decodes vector tiles into a binary form by default. Verified
        // against @loaders.gl/gis and deck.gl 9.3.7: a numeric property is
        // hoisted into one tile-wide typed array covering every feature, zero
        // filled where the feature never carried it, and merged wholesale into
        // the object accessors receive. Two polygons, only the first carrying
        // `ele`, come back as:
        //   {properties: {layerName: 'mountain_peak', name: 'Peak', ele: 3000}}
        //   {properties: {layerName: 'landcover', class: 'grass', ele: 0}}
        // The string properties kept alongside omit the key entirely and there
        // is no presence mask, so a missing measurement cannot be told from a
        // real zero. The fix is to stop asking for binary when it matters.
        test.each([
            ['fillColorProp', { fillColorProp: 'c' }],
            ['fillOpacityProp', { fillOpacityProp: 'fo' }],
            ['colorProp', { colorProp: 'c' }],
            ['opacityProp', { opacityProp: 'o' }],
            ['weightProp', { weightProp: 'w' }],
            ['radiusProp', { radiusProp: 'r' }],
        ])('decodes as GeoJSON when %s reads a property', (_label, extra) => {
            // The same zero fill feeds every *Prop field, so a feature lacking
            // the property would read 0 - an invisible line width, a zero
            // radius - rather than falling back to the configured value.
            const layer = buildDeckLayer(`prop-binary-off-${_label}`, {
                type: 'vectortile',
                url: 'https://example.com/tiles/{z}/{x}/{y}.mvt',
                style: { fillColor: '#ff00ff', ...extra },
            })
            expect(layer.props.binary).toBe(false)
        })

        test('keeps binary decoding when no accessor reads a property', () => {
            const layer = buildDeckLayer('binary-kept', {
                type: 'vectortile',
                url: 'https://example.com/tiles/{z}/{x}/{y}.mvt',
                style: { fillColor: '#ff00ff', radius: 5, weight: 2 },
            })
            expect(layer.props.binary).toBe(true)
        })

        test('lets a buildDeckLayer caller override the tile decoding format', () => {
            // An adapter-internal channel: no makeLayer call site forwards
            // a layer's own nativeOptions, so a mission cannot reach it.
            const layer = buildDeckLayer('binary-override', {
                type: 'vectortile',
                url: 'https://example.com/tiles/{z}/{x}/{y}.mvt',
                style: { fillColor: '#ff00ff', fillColorProp: 'c' },
            })
            expect(layer.props.binary).toBe(false)
            const overridden = buildDeckLayer('binary-override-2', {
                type: 'vectortile',
                url: 'https://example.com/tiles/{z}/{x}/{y}.mvt',
                style: { fillColor: '#ff00ff', fillColorProp: 'c' },
                nativeOptions: { binary: true },
            })
            expect(overridden.props.binary).toBe(true)
        })

        test('creates a ScatterplotLayer for scatterplot type', () => {
            const layer = buildDeckLayer('scatter-1', {
                type: 'scatterplot',
                data: [{ position: [0, 0] }],
            })
            expect(layer.id).toBe('scatter-1')
        })

        test('creates a ScatterplotLayer via ScatterplotLayer alias', () => {
            const layer = buildDeckLayer('scatter-2', {
                type: 'ScatterplotLayer',
                data: [{ position: [0, 0] }],
            })
            expect(layer.id).toBe('scatter-2')
        })

        test('creates a Tile3DLayer for tile3d type', () => {
            const layer = buildDeckLayer('t3d-1', {
                type: 'tile3d',
                url: 'https://example.com/tileset.json',
            })
            expect(layer.id).toBe('t3d-1')
        })

        test('creates a Tile3DLayer via Tile3DLayer alias', () => {
            const layer = buildDeckLayer('t3d-2', {
                type: 'Tile3DLayer',
                url: 'https://example.com/tileset.json',
            })
            expect(layer.id).toBe('t3d-2')
        })

        // Layer opacity is carried by the deck.gl `opacity` prop on every type,
        // so setLayerOpacity has a single prop to update after construction.
        test.each([
            ['tile', { url: 'https://example.com/{z}/{x}/{y}.png' }],
            ['vector', { geojson: { type: 'FeatureCollection', features: [] } }],
            ['vectortile', { url: 'https://example.com/{z}/{x}/{y}.mvt' }],
            ['scatterplot', { data: [{ position: [0, 0] }] }],
            ['tile3d', { url: 'https://example.com/tileset.json' }],
            ['pointcloud', { url: '/data/cloud.las' }],
        ])('%s layer carries the opacity prop', (type, options) => {
            const layer = buildDeckLayer(`op-${type}`, { type, opacity: 0.35, ...options })
            expect(layer.props.opacity).toBe(0.35)
        })

        test('opacity defaults to 1 when not supplied', () => {
            const layer = buildDeckLayer('op-default', {
                type: 'vector',
                geojson: { type: 'FeatureCollection', features: [] },
            })
            expect(layer.props.opacity).toBe(1)
        })

        test('vector layer opacity is independent of style.opacity', () => {
            // style.opacity is the configured stroke alpha; layer opacity is a
            // separate multiplier. Baking one into the other double-applies it.
            const layer = buildDeckLayer('op-vec-style', {
                type: 'vector',
                geojson: { type: 'FeatureCollection', features: [] },
                opacity: 0.5,
                style: { color: '#ff0000', opacity: 1 },
            })
            expect(layer.props.opacity).toBe(0.5)
            expect(layer.props.getLineColor).toEqual([255, 0, 0, 255])
        })
    })

    test.describe('hexToRgba', () => {
        test('parses #RRGGBB hex string', () => {
            expect(hexToRgba('#ff0000')).toEqual([255, 0, 0, 255])
        })

        test('parses #RGB shorthand hex string', () => {
            expect(hexToRgba('#f00')).toEqual([255, 0, 0, 255])
        })

        test('overrides alpha with opacity argument', () => {
            const [r, g, b, a] = hexToRgba('#ffffff', 0.5)
            expect(r).toBe(255)
            expect(g).toBe(255)
            expect(b).toBe(255)
            expect(a).toBeCloseTo(128, 0)
        })

        test('opacity 0 yields alpha 0', () => {
            const [, , , a] = hexToRgba('#ffffff', 0)
            expect(a).toBe(0)
        })

        test('opacity 1 yields alpha 255', () => {
            const [, , , a] = hexToRgba('#000000', 1)
            expect(a).toBe(255)
        })

        test('returns defaultColor for null input', () => {
            const fallback = [100, 150, 200, 255]
            expect(hexToRgba(null, undefined, fallback)).toEqual(fallback)
        })

        test('returns defaultColor for unparseable string', () => {
            const fallback = [1, 2, 3, 4]
            expect(hexToRgba('not-a-color', undefined, fallback)).toEqual(fallback)
        })

        test('uses default fallback [255,255,255,255] when none provided', () => {
            expect(hexToRgba(null)).toEqual([255, 255, 255, 255])
        })

        test('parses CSS named color "red"', () => {
            expect(hexToRgba('red')).toEqual([255, 0, 0, 255])
        })
    })
})
