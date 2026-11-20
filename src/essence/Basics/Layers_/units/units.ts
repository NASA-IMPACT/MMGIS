import { readEntries, readScaleValues } from '../legend/entries'
import type { ActiveUnit, LayerUnit, LayerUnitAnswer, UnitOption } from './types'

type LayerConfig = {
    cogUnits?: string | null
    currentUnit?: string | null
    _legend?: unknown
    variables?: { unit?: unknown; legend?: unknown } | null
    [key: string]: unknown
}

const nonBlank = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : null

// The property a layer's values live in: declared on the unit, else the one
// its legend styles by.
const measuredProperty = (config: LayerConfig): string | null => {
    const declared = nonBlank((config.variables?.unit as { property?: unknown })?.property)
    if (declared) return declared
    for (const legend of [config.variables?.legend, config._legend]) {
        if (!Array.isArray(legend)) continue
        for (const entry of legend) {
            const name = nonBlank((entry as { propertyName?: unknown })?.propertyName)
            if (name) return name
        }
    }
    return null
}

const MICRO = /[µμ]/g

const normalize = (label: unknown): string =>
    String(label ?? '')
        .replace(MICRO, 'μ')
        .trim()
        .toLowerCase()

export const sameUnit = (a: unknown, b: unknown): boolean => {
    const left = normalize(a)
    return left !== '' && left === normalize(b)
}

// Configure's number fields store what was typed, so a factor may arrive as
// '0.001'; a blank offset means none.
const asNumber = (value: unknown): number | undefined => {
    if (value == null || value === '') return undefined
    const num = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(num) ? num : NaN
}

const usableOption = (option: unknown): UnitOption | null => {
    if (option == null || typeof option !== 'object') return null
    const { label, scale, offset } = option as Record<string, unknown>
    if (typeof label !== 'string' || label.trim() === '') return null
    const factor = asNumber(scale)
    if (factor === undefined || !Number.isFinite(factor) || factor === 0) return null
    const shift = asNumber(offset)
    if (shift !== undefined && !Number.isFinite(shift)) return null
    return { label: label.trim(), scale: factor, ...(shift != null ? { offset: shift } : {}) }
}

const declaredUnit = (config: LayerConfig): LayerUnit | null => {
    const unit = config.variables?.unit as Partial<LayerUnit> | undefined
    if (!unit || typeof unit !== 'object') return null
    if (typeof unit.source_unit !== 'string' || unit.source_unit.trim() === '')
        return null
    const options = Array.isArray(unit.options)
        ? unit.options.map(usableOption).filter((o): o is UnitOption => o !== null)
        : []
    return {
        source_unit: unit.source_unit.trim(),
        ...(typeof unit.display_unit === 'string' && unit.display_unit.trim()
            ? { display_unit: unit.display_unit.trim() }
            : {}),
        ...(options.length ? { options } : {}),
    }
}

export const resolveLayerUnit = (config: LayerConfig | null | undefined): LayerUnit | null => {
    if (!config) return null
    const declared = declaredUnit(config)
    if (declared) return declared
    if (typeof config.cogUnits === 'string' && config.cogUnits.trim())
        return { source_unit: config.cogUnits.trim() }
    const entries = readEntries(config._legend)
    const scale = entries.length ? readScaleValues(entries) : null
    if (scale?.unit) return { source_unit: scale.unit }
    return null
}

const asActive = (source_unit: string, option: UnitOption): ActiveUnit => ({
    source_unit,
    label: option.label,
    scale: option.scale,
    offset: option.offset ?? 0,
})

export const activeUnit = (config: LayerConfig | null | undefined): ActiveUnit | null => {
    const unit = resolveLayerUnit(config)
    if (!unit) return null
    const source: UnitOption = { label: unit.source_unit, scale: 1, offset: 0 }
    const choices = [source, ...(unit.options ?? [])]
    const pick = (label: unknown) =>
        label == null ? undefined : choices.find((o) => sameUnit(o.label, label))
    const chosen = pick(config?.currentUnit) ?? pick(unit.display_unit) ?? source
    return asActive(unit.source_unit, chosen)
}

// 18 × 0.001 is 0.018000000000000002 in floating point; twelve significant
// digits keep every real measurement and drop that noise.
const tidy = (value: number): number => Number(value.toPrecision(12))

export const toDisplay = <T>(value: T, unit: ActiveUnit | null | undefined): T | number => {
    if (!unit || typeof value !== 'number' || !Number.isFinite(value)) return value
    return tidy(value * unit.scale + unit.offset)
}

export const toSource = <T>(value: T, unit: ActiveUnit | null | undefined): T | number => {
    if (!unit || typeof value !== 'number' || !Number.isFinite(value)) return value
    return tidy((value - unit.offset) / unit.scale)
}

export const layerUnitAnswer = (config: LayerConfig | null | undefined): LayerUnitAnswer | null => {
    const unit = resolveLayerUnit(config)
    const active = activeUnit(config)
    if (!unit || !active) return null
    const source = { label: unit.source_unit, scale: 1, offset: 0 }
    const options = (unit.options ?? []).map((o) => ({ ...o, offset: o.offset ?? 0 }))
    return {
        source_unit: unit.source_unit,
        property: measuredProperty(config),
        active,
        options: [source, ...options],
    }
}

export const findUnitOption = (
    config: LayerConfig | null | undefined,
    label: unknown,
): Required<UnitOption> | null => {
    const answer = layerUnitAnswer(config)
    if (!answer) return null
    return answer.options.find((o) => sameUnit(o.label, label)) ?? null
}
