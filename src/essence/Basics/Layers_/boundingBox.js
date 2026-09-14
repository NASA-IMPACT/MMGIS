/**
 * Reading a four-number geographic box, shared by everything that is handed
 * one.
 *
 * A box reaches MMGIS from two directions - typed into mission configuration,
 * or reported by a tile service - and the parsing is the same both ways: four
 * values that must each be a finite number of degrees. What to do with a box
 * that is out of range or runs backwards is not the same both ways, and stays
 * with the caller: a configured box is refused when it leaves +-180 / +-90,
 * because a box in projected units is the likely cause; a service's box is
 * clamped, because TiTiler routinely reports a hair past the edge.
 */

/**
 * Four values as four finite degrees, `[x1, y1, x2, y2]` in the order given,
 * or null when they are not four numbers.
 *
 * Values are read with `parseFloat`, so a box written as strings reads as the
 * numbers it spells and a half-filled one - an empty corner, a word where a
 * number belongs - is refused whole rather than counted as zero.
 *
 * @param {unknown} values - Four values, as numbers or as strings.
 * @returns {[number, number, number, number] | null}
 */
export function fourFiniteDegrees(values) {
    if (!Array.isArray(values) || values.length !== 4) return null
    const [x1, y1, x2, y2] = values.map((n) => parseFloat(n))
    if (![x1, y1, x2, y2].every(Number.isFinite)) return null
    return [x1, y1, x2, y2]
}

/**
 * Four values as a `[west, south, east, north]` tuple of degrees, each axis
 * put the right way round, or null when they are not four numbers.
 *
 * Ordering reads a box whose corners are transposed - east written where west
 * belongs - as the box it describes, which is also what Leaflet's
 * `latLngBounds` reads it as. A footprint that crosses the antimeridian, west
 * 170 and east -170, is a different thing and is not representable this way:
 * it reads as the complementary box across the other 340 degrees.
 *
 * @param {unknown} values - Four values, as numbers or as strings.
 * @returns {[number, number, number, number] | null}
 */
export function orderedDegreeBox(values) {
    const corners = fourFiniteDegrees(values)
    if (corners == null) return null
    const [x1, y1, x2, y2] = corners
    return [
        Math.min(x1, x2),
        Math.min(y1, y2),
        Math.max(x1, x2),
        Math.max(y1, y2),
    ]
}
