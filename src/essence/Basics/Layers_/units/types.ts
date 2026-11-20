export interface UnitOption {
    label: string
    scale: number
    offset?: number
}

export interface LayerUnitConfig {
    sourceUnit: string
    displayUnit?: string
    options?: UnitOption[]
}

export interface ActiveUnit {
    sourceUnit: string
    label: string
    scale: number
    offset: number
}
