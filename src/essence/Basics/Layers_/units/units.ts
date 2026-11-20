import { readScaleValues } from '../legend/buildLayerLegend'
import type { ActiveUnit, LayerUnitConfig, LayerUnitAnswer, UnitOption } from './types'

type LayerConfig = {
    cogUnits?: string | null
    currentUnit?: string | null
    _legend?: { value?: string | number }[]
    variables?: { unit?: unknown } | null
    [key: string]: unknown
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
    const legend = Array.isArray(config._legend) ? config._legend : []
    const scale = legend.length ? readScaleValues(legend) : null
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
    return { sourceUnit: unit.sourceUnit, active, options: [source, ...options] }
}
