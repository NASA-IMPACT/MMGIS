// MMGIS-coupled loader: fetches the mission's layer configs over the bus,
// pairs them with the configured catalogue, and returns engine rows.
// All parsing/joining logic is pure (lib/catalog); this file only feeds it.

import { mmgisRequest } from '../../_shared/adapters/mmgisAPI'
import { parseCatalog } from '../lib/catalog/parseCatalog'
import { buildRows, type LayerInput } from '../lib/catalog/buildRows'
import { stacBboxToPolygon } from '../lib/utils/geo'
import type { Row } from '../lib/engine/types'

export async function loadCatalogRows(catalogInput: unknown): Promise<Row[]> {
    const layerConfigs = await mmgisRequest<
        Record<string, { type?: unknown; properties?: Record<string, unknown> }>
    >('layers:getAllConfigs')

    const layers: LayerInput[] = []
    for (const [uuid, cfg] of Object.entries(layerConfigs ?? {})) {
        if (!cfg || cfg.type === 'header') continue
        const props = cfg.properties ?? {}
        layers.push({
            layerKey: uuid,
            layerProps: props,
            layerGeometry: stacBboxToPolygon(props.bbox) ?? undefined,
        })
    }

    const catalog = parseCatalog(catalogInput)
    const built = buildRows(layers, catalog)
    for (const warning of [...catalog.warnings, ...built.warnings]) {
        console.warn(`[LayerFilter] ${warning}`)
    }
    return built.rows
}
