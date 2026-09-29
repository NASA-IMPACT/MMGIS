/**
 * GPU parameters for deck.gl layers that lie flat on the map: raster and
 * vector tiles, COGs, GeoJSON, WMS, point markers.
 *
 * deck.gl draws interleaved with the basemap and shares its depth buffer. A
 * basemap style with 3D terrain writes the terrain surface into that buffer,
 * and a layer drawn at sea level with the depth test on loses every pixel the
 * terrain stands in front of, so it shows holes the shape of the land. Flat
 * layers ignore depth instead and stack in the order they are drawn, as they
 * would on a 2D map.
 *
 * Layers with real height — 3D tiles, point clouds, extruded polygons, raised
 * tiles — keep deck.gl's depth test.
 */
export const FLAT_LAYER_PARAMETERS = {
    depthCompare: 'always',
    depthWriteEnabled: false,
} as const
