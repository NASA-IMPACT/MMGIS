import { readEntries, readScaleValues } from '../legend/entries'
import type { ActiveUnit, LayerUnitConfig, LayerUnitAnswer, UnitOption } from './types'

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

const isUnitOption = (option: unknown): option is UnitOption =>
    option != null &&
    typeof option === 'object' &&
    typeof (option as UnitOption).label === 'string' &&
    (option as UnitOption).label.trim() !== '' &&
    Number.isFinite((option as UnitOption).scale) &&
    (option as UnitOption).scale !== 0 &&
    ((option as UnitOption).offset == null ||
        Number.isFinite((option as UnitOption).offset))

const declaredUnit = (config: LayerConfig): LayerUnitConfig | null => {
    const unit = config.variables?.unit as Partial<LayerUnitConfig> | undefined
    if (!unit || typeof unit !== 'object') return null
    if (typeof unit.sourceUnit !== 'string' || unit.sourceUnit.trim() === '')
        return null
    const options = Array.isArray(unit.options)
        ? unit.options.filter(isUnitOption)
        : []
    return {
        sourceUnit: unit.sourceUnit.trim(),
        ...(typeof unit.displayUnit === 'string' && unit.displayUnit.trim()
            ? { displayUnit: unit.displayUnit.trim() }
            : {}),
        ...(options.length ? { options } : {}),
    }
}

export const resolveLayerUnit = (config: LayerConfig | null | undefined): LayerUnitConfig | null => {
    if (!config) return null
    const declared = declaredUnit(config)
    if (declared) return declared
    if (typeof config.cogUnits === 'string' && config.cogUnits.trim())
        return { sourceUnit: config.cogUnits.trim() }
    const entries = readEntries(config._legend)
    const scale = entries.length ? readScaleValues(entries) : null
    if (scale?.unit) return { sourceUnit: scale.unit }
    return null
}

const asActive = (sourceUnit: string, option: UnitOption): ActiveUnit => ({
    sourceUnit,
    label: option.label,
    scale: option.scale,
    offset: option.offset ?? 0,
})

export const activeUnit = (config: LayerConfig | null | undefined): ActiveUnit | null => {
    const unit = resolveLayerUnit(config)
    if (!unit) return null
    const source: UnitOption = { label: unit.sourceUnit, scale: 1, offset: 0 }
    const choices = [source, ...(unit.options ?? [])]
    const pick = (label: unknown) =>
        label == null ? undefined : choices.find((o) => sameUnit(o.label, label))
    const chosen = pick(config?.currentUnit) ?? pick(unit.displayUnit) ?? source
    return asActive(unit.sourceUnit, chosen)
}

export const toDisplay = <T>(value: T, unit: ActiveUnit | null | undefined): T | number => {
    if (!unit || typeof value !== 'number' || !Number.isFinite(value)) return value
    return value * unit.scale + unit.offset
}

export const toSource = <T>(value: T, unit: ActiveUnit | null | undefined): T | number => {
    if (!unit || typeof value !== 'number' || !Number.isFinite(value)) return value
    return (value - unit.offset) / unit.scale
}

export const layerUnitAnswer = (config: LayerConfig | null | undefined): LayerUnitAnswer | null => {
    const unit = resolveLayerUnit(config)
    const active = activeUnit(config)
    if (!unit || !active) return null
    const source = { label: unit.sourceUnit, scale: 1, offset: 0 }
    const options = (unit.options ?? []).map((o) => ({ ...o, offset: o.offset ?? 0 }))
    return {
        sourceUnit: unit.sourceUnit,
        property: measuredProperty(config),
        active,
        options: [source, ...options],
    }
}
