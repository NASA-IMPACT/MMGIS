import { readEntries, readScaleValues } from '../legend/entries'
import type { ActiveUnit, LayerUnit, LayerUnitAnswer, UnitOption } from './types'

type LayerConfig = {
    cogUnits?: string | null
    currentUnit?: string | null
    _legend?: unknown
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

const isUsableOption = (option: unknown): option is UnitOption =>
    option != null &&
    typeof option === 'object' &&
    typeof (option as UnitOption).label === 'string' &&
    (option as UnitOption).label.trim() !== '' &&
    Number.isFinite((option as UnitOption).scale) &&
    (option as UnitOption).scale !== 0 &&
    ((option as UnitOption).offset == null ||
        Number.isFinite((option as UnitOption).offset))

const declaredUnit = (config: LayerConfig): LayerUnit | null => {
    const unit = config.variables?.unit as Partial<LayerUnit> | undefined
    if (!unit || typeof unit !== 'object') return null
    if (typeof unit.source_unit !== 'string' || unit.source_unit.trim() === '')
        return null
    const options = Array.isArray(unit.options)
        ? unit.options.filter(isUsableOption)
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
    const source = { label: unit.source_unit, scale: 1, offset: 0 }
    const options = (unit.options ?? []).map((o) => ({ ...o, offset: o.offset ?? 0 }))
    return { source_unit: unit.source_unit, active, options: [source, ...options] }
}
