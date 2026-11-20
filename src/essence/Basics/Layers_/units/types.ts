export interface UnitOption {
    label: string
    scale: number
    offset?: number
}

export interface LayerUnit {
    source_unit: string
    display_unit?: string
    options?: UnitOption[]
}

export interface ActiveUnit {
    source_unit: string
    label: string
    scale: number
    offset: number
}

export interface LayerUnitAnswer {
    source_unit: string
    property: string | null
    active: ActiveUnit
    options: Required<UnitOption>[]
}
