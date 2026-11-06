// Scale bar arithmetic, shared by the on-screen bar and the exported one so
// both show the same distance for the same view.

export type ScaleUnits = 'metric' | 'imperial'

export type ScaleUnitLabel = 'm' | 'km' | 'ft' | 'mi'

export type ScaleBarModel = {
    /** The round distance the bar spans, in `unit`. */
    distance: number
    unit: ScaleUnitLabel
    label: string
    /** The bar's length, in the same pixels as the metres-per-pixel input. */
    widthPx: number
}

/** The longest the on-screen bar grows, in CSS pixels. */
export const SCALE_BAR_MAX_WIDTH_PX = 150

const FEET_PER_METER = 3.280839895
const FEET_PER_MILE = 5280
const METERS_PER_KILOMETER = 1000

/** Anything other than 'imperial' reads as metric. */
export const resolveScaleUnits = (value: unknown): ScaleUnits =>
    value === 'imperial' ? 'imperial' : 'metric'

/** The largest 1, 2 or 5 × 10^n not exceeding `max`; toPrecision strips
 *  float noise so 0.2 reads as 0.2. */
export function niceScaleDistance(max: number): number {
    const pow10 = Math.pow(10, Math.floor(Math.log10(max)))
    const mantissa = max / pow10
    const nice = mantissa >= 5 ? 5 : mantissa >= 2 ? 2 : 1
    return parseFloat((nice * pow10).toPrecision(12))
}

/** What to draw for a bar at most `maxWidthPx` long; null for an unknown scale. */
export function buildScaleBarModel(
    metersPerPixel: number | null | undefined,
    units: ScaleUnits,
    maxWidthPx: number,
): ScaleBarModel | null {
    if (
        typeof metersPerPixel !== 'number' ||
        !Number.isFinite(metersPerPixel) ||
        metersPerPixel <= 0 ||
        !(maxWidthPx > 0)
    ) {
        return null
    }
    const maxMeters = metersPerPixel * maxWidthPx
    let maxInUnit: number
    let unit: ScaleUnitLabel
    if (units === 'imperial') {
        const maxFeet = maxMeters * FEET_PER_METER
        if (maxFeet >= FEET_PER_MILE) {
            maxInUnit = maxFeet / FEET_PER_MILE
            unit = 'mi'
        } else {
            maxInUnit = maxFeet
            unit = 'ft'
        }
    } else if (maxMeters >= METERS_PER_KILOMETER) {
        maxInUnit = maxMeters / METERS_PER_KILOMETER
        unit = 'km'
    } else {
        maxInUnit = maxMeters
        unit = 'm'
    }
    const distance = niceScaleDistance(maxInUnit)
    return {
        distance,
        unit,
        label: `${distance.toLocaleString('en-US', {
            maximumFractionDigits: 10,
        })} ${unit}`,
        widthPx: (maxWidthPx * distance) / maxInUnit,
    }
}
