import { readEntries, readScaleValues } from '../legend/entries'
import type { ActiveUnit, LayerUnitConfig, LayerUnitState, UnitOption } from './types'

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

// Unicode compatibility normalization folds lookalikes that are typed
// differently but mean the same thing (the micro sign and Greek mu, a
// superscript three and a 3), so a label matches however it was spelled.
export const unitKey = (label: unknown): string =>
    String(label ?? '').normalize('NFKC').trim().toLowerCase()

export const sameUnit = (a: unknown, b: unknown): boolean => {
    const left = unitKey(a)
    return left !== '' && left === unitKey(b)
}

// Configure's number fields store what was typed, so a factor may arrive as
// '0.001'; a blank offset means none.
const asNumber = (value: unknown): number | undefined => {
    if (value == null || value === '') return undefined
    const num = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(num) ? num : NaN
}

const readUnitOption = (option: unknown): UnitOption | null => {
    if (option == null || typeof option !== 'object') return null
    const { label, scale, offset } = option as Record<string, unknown>
    if (typeof label !== 'string' || label.trim() === '') return null
    const factor = asNumber(scale)
    if (factor === undefined || !Number.isFinite(factor) || factor === 0) return null
    const shift = asNumber(offset)
    if (shift !== undefined && !Number.isFinite(shift)) return null
    return { label: label.trim(), scale: factor, ...(shift != null ? { offset: shift } : {}) }
}

const declaredUnit = (config: LayerConfig): LayerUnitConfig | null => {
    const unit = config.variables?.unit as Partial<LayerUnitConfig> | undefined
    if (!unit || typeof unit !== 'object') return null
    if (typeof unit.sourceUnit !== 'string' || unit.sourceUnit.trim() === '')
        return null
    const options = Array.isArray(unit.options)
        ? unit.options.map(readUnitOption).filter((o): o is UnitOption => o !== null)
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

export const layerUnitState = (config: LayerConfig | null | undefined): LayerUnitState | null => {
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

export const findUnitOption = (
    config: LayerConfig | null | undefined,
    label: unknown,
): Required<UnitOption> | null => {
    const answer = layerUnitState(config)
    if (!answer) return null
    return answer.options.find((o) => sameUnit(o.label, label)) ?? null
}
