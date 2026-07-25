import type { MmgisClient } from './mmgisClient.js'

function isPlainObject(v: any): boolean {
    return v != null && typeof v === 'object' && !Array.isArray(v)
}

// RFC 7386 JSON Merge Patch. Returns a new value; never mutates `target`.
export function mergePatch(target: any, patch: any): any {
    if (!isPlainObject(patch)) return patch
    const base = isPlainObject(target) ? target : {}
    const out: any = { ...base }
    for (const [key, value] of Object.entries(patch)) {
        if (value === null) delete out[key]
        else out[key] = mergePatch(base[key], value)
    }
    return out
}

export interface EditInfo {
    type: string
    layerName?: string | string[]
}

export async function editConfig(
    client: MmgisClient,
    missionName: string,
    mutate: (config: any) => { info?: EditInfo } | void
): Promise<{ mission: string; version: number }> {
    const current = await client.getMission(missionName)
    const config = JSON.parse(JSON.stringify(current.config))
    const result = mutate(config) || {}
    return await client.upsertMission(missionName, config, {
        forceClientUpdate: true,
        info: result.info ?? { type: 'upsert' },
    })
}

export function findLayerIndex(config: any, nameOrUuid: string): number {
    const layers = Array.isArray(config?.layers) ? config.layers : []
    return layers.findIndex((l: any) => l?.name === nameOrUuid || l?.uuid === nameOrUuid)
}
