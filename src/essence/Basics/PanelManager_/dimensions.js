/**
 * Panel dimension values.
 *
 * A panel size is authored either as a plain number of pixels or as a CSS length
 * carrying a unit. Validation and rendering both read a size through here, so
 * they agree on what it means.
 */

/**
 * Units accepted inside a dimension string. A unit outside this set is rejected
 * rather than passed to the browser, which drops an unparsable declaration
 * without reporting it.
 */
export const CSS_DIMENSION_UNITS = [
    'px',
    '%',
    'vh',
    'vw',
    'svh',
    'dvh',
    'vmin',
    'vmax',
    'ch',
    'rem',
    'em',
]

const NUMERIC_PATTERN = /^\d+(?:\.\d+)?$/
const UNIT_PATTERN = new RegExp(
    `^(\\d+(?:\\.\\d+)?)(${CSS_DIMENSION_UNITS.join('|')})$`
)
const PIXEL_PATTERN = /^(\d+(?:\.\d+)?)px$/

/**
 * Whether a value carries a configured dimension. An absent key and an empty
 * string both mean "not set": the Configure form writes an empty string for a
 * field an admin has cleared.
 *
 * @param {*} v
 * @returns {boolean}
 */
export function isDimensionSet(v) {
    if (v === undefined || v === null) return false
    if (typeof v === 'string' && v.trim() === '') return false
    return true
}

/**
 * The CSS length for a configured dimension, or null when it is unset or
 * unusable. A bare number or a numeric string means pixels. Zero counts as
 * unusable: a panel sized to nothing cannot be told apart from a broken one.
 *
 * @param {*} v
 * @returns {string|null}
 */
export function toCssDimension(v) {
    if (!isDimensionSet(v)) return null

    if (typeof v === 'number') {
        return Number.isFinite(v) && v > 0 ? `${v}px` : null
    }

    if (typeof v === 'string') {
        const s = v.trim()
        if (NUMERIC_PATTERN.test(s)) {
            const n = Number(s)
            return n > 0 ? `${n}px` : null
        }
        const match = UNIT_PATTERN.exec(s)
        if (match) return Number(match[1]) > 0 ? s : null
    }

    return null
}

/**
 * The pixel count for a dimension that is only ever pixels, or null when it is
 * unset or unusable. A "300px" string reads back as its number.
 *
 * @param {*} v
 * @param {{allowZero?: boolean}} [options] - allowZero keeps 0 usable, which
 *        suits a floor (minSize) but never a cap or a size.
 * @returns {number|null}
 */
export function toPixelNumber(v, options = {}) {
    const { allowZero = false } = options
    if (!isDimensionSet(v)) return null

    let n = null
    if (typeof v === 'number') {
        n = v
    } else if (typeof v === 'string') {
        const s = v.trim()
        if (NUMERIC_PATTERN.test(s)) {
            n = Number(s)
        } else {
            const match = PIXEL_PATTERN.exec(s)
            if (match) n = Number(match[1])
        }
    }

    if (n === null || !Number.isFinite(n) || n < 0) return null
    if (n === 0 && !allowZero) return null
    return n
}

/** What a dimension field accepts, phrased for a validation message. */
export const DIMENSION_HINT = `a number of pixels or a CSS length with a unit (${CSS_DIMENSION_UNITS.join(', ')})`
