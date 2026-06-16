// Client-side proj4 -> WKT1 (.prj) conversion for static builds, standing in
// for the backend's GDAL-based 'proj42wkt' endpoint. Mirrors GDAL's WKT1
// output for the projection methods MMGIS missions use and returns null for
// anything it cannot faithfully express, so callers degrade the same way a
// failed backend call would.
import proj4 from 'proj4'

// Trim float noise from unit conversions (e.g. -96.00000000000001 -> -96)
const clean = (v) => Math.round(v * 1e9) / 1e9

// Pull a numeric `+key=value` parameter straight from the proj string.
// proj4.Proj derives/backfills fields (lat_ts, lat_1, ...) during init, so
// the raw string is the only reliable presence test for optional parameters.
const rawParam = (projString, key) => {
    const match = new RegExp(`\\+${key}=([^\\s]+)`).exec(projString)
    if (match == null) return null
    const value = parseFloat(match[1])
    return isNaN(value) ? null : value
}

const SPHEROID_NAMES = {
    WGS84: 'WGS 84',
    GRS80: 'GRS 1980',
    intl: 'International 1909 (Hayford)',
    clrk66: 'Clarke 1866',
    sphere: 'Sphere',
}

const DATUM_NAMES = {
    WGS84: 'WGS_1984',
    NAD83: 'North_American_Datum_1983',
    NAD27: 'North_American_Datum_1927',
}

// Map a proj4 projection to its WKT1 PROJECTION name and PARAMETER list,
// following GDAL's proj4 -> WKT1 conventions. Returns null when the
// projection (or its variant) has no faithful WKT1 mapping here.
const mapProjection = (projName, g, proj) => {
    const FE = ['false_easting', g('x_0', 0)]
    const FN = ['false_northing', g('y_0', 0)]
    switch (projName) {
        case 'merc':
            if (g('lat_ts', null) != null)
                return {
                    name: 'Mercator_2SP',
                    params: [
                        ['standard_parallel_1', g('lat_ts', 0)],
                        ['central_meridian', g('lon_0', 0)],
                        FE,
                        FN,
                    ],
                }
            return {
                name: 'Mercator_1SP',
                params: [
                    ['central_meridian', g('lon_0', 0)],
                    ['scale_factor', g('k', g('k_0', 1))],
                    FE,
                    FN,
                ],
            }
        case 'eqc':
            return {
                name: 'Equirectangular',
                params: [
                    ['latitude_of_origin', g('lat_0', 0)],
                    ['central_meridian', g('lon_0', 0)],
                    ['standard_parallel_1', g('lat_ts', 0)],
                    FE,
                    FN,
                ],
            }
        case 'stere':
            if (Math.abs(g('lat_0', 0)) === 90)
                return {
                    name: 'Polar_Stereographic',
                    params: [
                        [
                            'latitude_of_origin',
                            g('lat_ts', null) != null
                                ? g('lat_ts', 0)
                                : g('lat_0', 0),
                        ],
                        ['central_meridian', g('lon_0', 0)],
                        ['scale_factor', g('k', g('k_0', 1))],
                        FE,
                        FN,
                    ],
                }
            return {
                name: 'Stereographic',
                params: [
                    ['latitude_of_origin', g('lat_0', 0)],
                    ['central_meridian', g('lon_0', 0)],
                    ['scale_factor', g('k', g('k_0', 1))],
                    FE,
                    FN,
                ],
            }
        case 'sterea':
            return {
                name: 'Oblique_Stereographic',
                params: [
                    ['latitude_of_origin', g('lat_0', 0)],
                    ['central_meridian', g('lon_0', 0)],
                    ['scale_factor', g('k', g('k_0', 1))],
                    FE,
                    FN,
                ],
            }
        case 'tmerc':
            return {
                name: 'Transverse_Mercator',
                params: [
                    ['latitude_of_origin', g('lat_0', 0)],
                    ['central_meridian', g('lon_0', 0)],
                    ['scale_factor', g('k', g('k_0', 1))],
                    FE,
                    FN,
                ],
            }
        case 'utm':
            // proj4's init expands the zone into long0/k0/x0/y0 (radians)
            return {
                name: 'Transverse_Mercator',
                params: [
                    ['latitude_of_origin', 0],
                    ['central_meridian', clean((proj.long0 * 180) / Math.PI)],
                    ['scale_factor', proj.k0],
                    ['false_easting', proj.x0],
                    ['false_northing', proj.y0],
                ],
            }
        case 'lcc':
            if (g('lat_2', null) != null)
                return {
                    name: 'Lambert_Conformal_Conic_2SP',
                    params: [
                        ['standard_parallel_1', g('lat_1', 0)],
                        ['standard_parallel_2', g('lat_2', 0)],
                        ['latitude_of_origin', g('lat_0', 0)],
                        ['central_meridian', g('lon_0', 0)],
                        FE,
                        FN,
                    ],
                }
            return {
                name: 'Lambert_Conformal_Conic_1SP',
                params: [
                    ['latitude_of_origin', g('lat_1', g('lat_0', 0))],
                    ['central_meridian', g('lon_0', 0)],
                    ['scale_factor', g('k', g('k_0', 1))],
                    FE,
                    FN,
                ],
            }
        case 'laea':
            return {
                name: 'Lambert_Azimuthal_Equal_Area',
                params: [
                    ['latitude_of_center', g('lat_0', 0)],
                    ['longitude_of_center', g('lon_0', 0)],
                    FE,
                    FN,
                ],
            }
        case 'aea':
            return {
                name: 'Albers_Conic_Equal_Area',
                params: [
                    ['standard_parallel_1', g('lat_1', 0)],
                    ['standard_parallel_2', g('lat_2', 0)],
                    ['latitude_of_center', g('lat_0', 0)],
                    ['longitude_of_center', g('lon_0', 0)],
                    FE,
                    FN,
                ],
            }
        case 'cea':
            return {
                name: 'Cylindrical_Equal_Area',
                params: [
                    ['standard_parallel_1', g('lat_ts', 0)],
                    ['central_meridian', g('lon_0', 0)],
                    FE,
                    FN,
                ],
            }
        case 'sinu':
            return {
                name: 'Sinusoidal',
                params: [['longitude_of_center', g('lon_0', 0)], FE, FN],
            }
        default:
            return null
    }
}

/**
 * Convert a proj4 definition string to an Esri/GDAL-style WKT1 string
 * suitable for a shapefile's .prj.
 * @param {string} projString - e.g. '+proj=merc +lon_0=0 +a=6378137 ...'
 * @returns {string|null} WKT1 string, or null if the input is missing,
 *     unparsable, or uses a projection without a faithful mapping
 */
const projStringToWkt = (projString) => {
    if (typeof projString !== 'string' || projString.indexOf('+proj=') === -1)
        return null

    let proj
    try {
        proj = new proj4.Proj(projString)
    } catch (e) {
        return null
    }
    if (proj == null || proj.projName == null || proj.a == null) return null
    // Non-Greenwich prime meridians and non-'enu' axis orders are never
    // expressed in the WKT below, so claiming Greenwich/default would lie
    if (proj.from_greenwich) return null
    if (proj.axis != null && proj.axis !== 'enu') return null

    // Geographic coordinate system (datum/spheroid)
    const a = proj.a
    const b = proj.b != null ? proj.b : proj.a
    const invFlattening = a === b ? 0 : clean(a / (a - b))

    const datumMatch = /\+datum=([^\s]+)/.exec(projString)
    const ellpsMatch = /\+ellps=([^\s]+)/.exec(projString)
    const datumName = datumMatch
        ? DATUM_NAMES[datumMatch[1]] || datumMatch[1]
        : 'unknown'
    let spheroidName = 'unknown'
    if (ellpsMatch) {
        spheroidName = SPHEROID_NAMES[ellpsMatch[1]] || ellpsMatch[1]
    } else if (datumMatch) {
        spheroidName = SPHEROID_NAMES[datumMatch[1]] || 'unknown'
    }

    let datum = `DATUM["${datumName}",SPHEROID["${spheroidName}",${a},${invFlattening}]`
    const towgs84 = (proj.datum_params || []).map(Number)
    if (towgs84.length === 3 || towgs84.length === 7)
        datum += `,TOWGS84[${towgs84.join(',')}]`
    datum += ']'

    const geogcs = `GEOGCS["unknown",${datum},PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433]]`

    const projName = proj.projName
    if (
        projName === 'longlat' ||
        projName === 'latlong' ||
        projName === 'latlon' ||
        projName === 'lonlat'
    )
        return geogcs

    const g = (key, fallback) => {
        const value = rawParam(projString, key)
        return value != null ? value : fallback
    }
    const mapped = mapProjection(projName, g, proj)
    if (mapped == null) return null

    const parameters = mapped.params
        .map(([name, value]) => `PARAMETER["${name}",${value}]`)
        .join(',')
    const toMeter = proj.to_meter != null ? proj.to_meter : 1
    const unit =
        toMeter === 1 ? 'UNIT["metre",1]' : `UNIT["unknown",${toMeter}]`

    return `PROJCS["unknown",${geogcs},PROJECTION["${mapped.name}"],${parameters},${unit}]`
}

export default projStringToWkt
