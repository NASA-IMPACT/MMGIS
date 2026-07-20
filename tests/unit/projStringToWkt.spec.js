import { test, expect } from 'vitest'
import proj4 from 'proj4'
import projStringToWkt from '../../src/pre/projStringToWkt.js'

// Static builds compute the shapefile .prj client-side (PR 9) instead of
// calling the backend's GDAL proj42wkt endpoint. Faithfulness is asserted
// two ways: structural checks against GDAL-style WKT1, and a numeric
// round-trip — the source proj string and the produced WKT must define the
// same projection math (proj4 parses WKT1 natively). The round-trip uses
// Proj.forward directly because proj4's datum-shift step interprets an
// unknown WKT datum differently from a datum-less proj string (a quirk of
// proj4's transform pipeline, not of the projection definitions).

// The default CRS LeafletAdapter builds for radius-configured missions
const MERC_SPHERE =
    '+proj=merc +lon_0=0 +k=1 +x_0=0 +y_0=0 +a=6378137 +b=6378137 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs'

const D2R = Math.PI / 180

const roundTrip = (projString, wkt, lnglat) => {
    const fromProj = new proj4.Proj(projString).forward({
        x: lnglat[0] * D2R,
        y: lnglat[1] * D2R,
    })
    const fromWkt = new proj4.Proj(wkt).forward({
        x: lnglat[0] * D2R,
        y: lnglat[1] * D2R,
    })
    expect(fromWkt.x).toBeCloseTo(fromProj.x, 3)
    expect(fromWkt.y).toBeCloseTo(fromProj.y, 3)
}

test.describe('projStringToWkt', () => {
    test('converts the default spherical-mercator CRS', () => {
        const wkt = projStringToWkt(MERC_SPHERE)
        expect(wkt).toContain('PROJCS[')
        expect(wkt).toContain('PROJECTION["Mercator_1SP"]')
        expect(wkt).toContain('SPHEROID["unknown",6378137,0]')
        expect(wkt).toContain('TOWGS84[0,0,0,0,0,0,0]')
        expect(wkt).toContain('PARAMETER["scale_factor",1]')
        expect(wkt).toContain('UNIT["metre",1]')
        roundTrip(MERC_SPHERE, wkt, [137.2, -33.5])
    })

    test('converts a geographic (longlat) CRS to a bare GEOGCS', () => {
        const wkt = projStringToWkt('+proj=longlat +a=3396190 +b=3376200 +no_defs')
        expect(wkt.startsWith('GEOGCS[')).toBe(true)
        expect(wkt).not.toContain('PROJCS[')
        // Inverse flattening a/(a-b)
        expect(wkt).toContain('SPHEROID["unknown",3396190,169.894447224]')
        expect(wkt).toContain('UNIT["degree",0.0174532925199433]')
    })

    test('converts an equirectangular CRS', () => {
        const projString =
            '+proj=eqc +lat_ts=0 +lat_0=0 +lon_0=0 +x_0=0 +y_0=0 +a=3396190 +b=3396190 +units=m +no_defs'
        const wkt = projStringToWkt(projString)
        expect(wkt).toContain('PROJECTION["Equirectangular"]')
        expect(wkt).toContain('PARAMETER["standard_parallel_1",0]')
        roundTrip(projString, wkt, [54.4, -4.6])
    })

    test('converts a polar stereographic CRS', () => {
        const projString =
            '+proj=stere +lat_0=90 +lat_ts=90 +lon_0=0 +k=1 +x_0=0 +y_0=0 +a=3396190 +b=3376200 +units=m +no_defs'
        const wkt = projStringToWkt(projString)
        expect(wkt).toContain('PROJECTION["Polar_Stereographic"]')
        expect(wkt).toContain('PARAMETER["latitude_of_origin",90]')
        roundTrip(projString, wkt, [10, 80])
    })

    test('expands a UTM zone into Transverse_Mercator', () => {
        const projString = '+proj=utm +zone=31 +datum=WGS84 +units=m +no_defs'
        const wkt = projStringToWkt(projString)
        expect(wkt).toContain('PROJECTION["Transverse_Mercator"]')
        expect(wkt).toContain('PARAMETER["central_meridian",3]')
        expect(wkt).toContain('PARAMETER["scale_factor",0.9996]')
        expect(wkt).toContain('PARAMETER["false_easting",500000]')
        expect(wkt).toContain('DATUM["WGS_1984"')
        expect(wkt).toContain('SPHEROID["WGS 84"')
        roundTrip(projString, wkt, [4.35, 50.85])
    })

    test('converts Lambert conformal conic (2SP)', () => {
        const projString =
            '+proj=lcc +lat_1=33 +lat_2=45 +lat_0=39 +lon_0=-96 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs'
        const wkt = projStringToWkt(projString)
        expect(wkt).toContain('PROJECTION["Lambert_Conformal_Conic_2SP"]')
        expect(wkt).toContain('PARAMETER["standard_parallel_1",33]')
        expect(wkt).toContain('PARAMETER["standard_parallel_2",45]')
        expect(wkt).toContain('PARAMETER["central_meridian",-96]')
        roundTrip(projString, wkt, [-105.2, 39.7])
    })

    test('converts Mercator with a standard parallel to Mercator_2SP', () => {
        const projString =
            '+proj=merc +lat_ts=41 +lon_0=0 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs'
        const wkt = projStringToWkt(projString)
        expect(wkt).toContain('PROJECTION["Mercator_2SP"]')
        expect(wkt).toContain('PARAMETER["standard_parallel_1",41]')
        // No roundTrip: proj4js's merc projection does not register the
        // 'Mercator_2SP' WKT name, so it cannot parse this (GDAL-faithful)
        // output back. Structure-only pinning here.
        expect(wkt).not.toContain('scale_factor')
    })

    test('emits a non-metre UNIT for non-metre proj units', () => {
        const projString =
            '+proj=tmerc +lat_0=0 +lon_0=-87 +k=0.9996 +x_0=300000 +y_0=0 +datum=WGS84 +units=us-ft +no_defs'
        const wkt = projStringToWkt(projString)
        expect(wkt).toContain('PROJECTION["Transverse_Mercator"]')
        expect(wkt).not.toContain('UNIT["metre",1]]')
        expect(wkt).toMatch(/UNIT\["unknown",0\.304800609\d*\]\]$/)
    })

    test('returns null for a non-Greenwich prime meridian', () => {
        expect(
            projStringToWkt(
                '+proj=merc +lon_0=0 +k=1 +x_0=0 +y_0=0 +datum=WGS84 +units=m +pm=paris +no_defs'
            )
        ).toBeNull()
    })

    test('returns null for unsupported projections', () => {
        expect(
            projStringToWkt('+proj=igh +lon_0=0 +x_0=0 +y_0=0 +datum=WGS84')
        ).toBeNull()
    })

    test('returns null for unparsable or missing input', () => {
        expect(projStringToWkt('not a proj string')).toBeNull()
        expect(projStringToWkt('+proj=garbage +foo=1')).toBeNull()
        expect(projStringToWkt('')).toBeNull()
        expect(projStringToWkt(null)).toBeNull()
        expect(projStringToWkt(undefined)).toBeNull()
    })
})
