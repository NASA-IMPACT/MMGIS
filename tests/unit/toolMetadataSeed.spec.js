import { test, expect } from 'vitest'

const {
    POSITIONS,
    ORIENTATIONS,
    computeLegacyDefaults,
    buildMetadataSection,
    injectMetadata,
} = require('../../scripts/lib/tool-metadata-seed')

test.describe('computeLegacyDefaults', () => {
    test('uses policy defaults and inherits width/height', () => {
        expect(computeLegacyDefaults({})).toEqual({
            modernLayoutSupport: false,
            requiredOrientation: 'any',
            compatiblePositions: ['top', 'left', 'right', 'bottom'],
            preferredPosition: 'left',
            width: 300,
            height: 0,
            separatedTool: false,
            expandable: false,
            startHidden: false,
            startUnloaded: false,
        })
        expect(computeLegacyDefaults({ width: 420, height: 88 }).width).toBe(420)
        expect(computeLegacyDefaults({ width: 420, height: 88 }).height).toBe(88)
    })
})

test.describe('buildMetadataSection', () => {
    test('mirrors defaults into component fields and marks the row managed', () => {
        const d = computeLegacyDefaults({})
        const row = buildMetadataSection(d)
        expect(row._metadataManaged).toBe(true)
        const byField = Object.fromEntries(row.components.map((c) => [c.field, c]))
        expect(byField['metadata.modernLayoutSupport'].defaultChecked).toBe(false)
        expect(byField['metadata.requiredOrientation'].options).toEqual(ORIENTATIONS)
        expect(byField['metadata.compatiblePositions'].type).toBe('multiselect')
        expect(byField['metadata.compatiblePositions'].options).toEqual(POSITIONS)
        expect(byField['metadata.compatiblePositions'].default).toEqual(d.compatiblePositions)
        expect(byField['metadata.preferredPosition'].options).toEqual(POSITIONS)
        expect(byField['metadata.width'].default).toBe(300)
        expect(byField['metadata.width'].type).toBe('number')
    })
})

test.describe('injectMetadata', () => {
    test('adds block + row for a legacy tool and preserves existing rows', () => {
        const config = {
            name: 'Sample',
            config: { rows: [{ components: [{ field: 'variables.x', type: 'text' }] }] },
        }
        const out = injectMetadata(config, 'Sample')
        expect(out.metadata.modernLayoutSupport).toBe(false)
        expect(out.metadata.preferredPosition).toBe('left')
        expect(out.config.rows).toHaveLength(2)
        expect(out.config.rows[0].components[0].field).toBe('variables.x')
        expect(out.config.rows[1]._metadataManaged).toBe(true)
    })

    test('is idempotent — re-running yields identical output, no duplicate rows', () => {
        const config = { name: 'Sample', config: { rows: [] } }
        const once = injectMetadata(config, 'Sample')
        const twice = injectMetadata(JSON.parse(JSON.stringify(once)), 'Sample')
        expect(twice.config.rows.filter((r) => r._metadataManaged)).toHaveLength(1)
        expect(JSON.stringify(twice)).toBe(JSON.stringify(once))
    })

    test('preserves an existing metadata block (modern tool) but still adds the editor row', () => {
        const existing = {
            icon: 'layers-triple-outline',
            requiredOrientation: 'vertical',
            compatiblePositions: ['left', 'right'],
            preferredPosition: 'left',
            modernLayoutSupport: true,
            width: 320,
            height: 0,
        }
        const config = { name: 'LayerManager', metadata: existing, config: { rows: [] } }
        const out = injectMetadata(config, 'LayerManager')
        expect(out.metadata).toEqual(existing)
        const row = out.config.rows.find((r) => r._metadataManaged)
        const byField = Object.fromEntries(row.components.map((c) => [c.field, c]))
        expect(byField['metadata.modernLayoutSupport'].defaultChecked).toBe(true)
        expect(byField['metadata.width'].default).toBe(320)
    })

    test('creates config.rows when the tool has no config', () => {
        const config = { name: 'Chemistry' }
        const out = injectMetadata(config, 'Chemistry')
        expect(Array.isArray(out.config.rows)).toBe(true)
        expect(out.config.rows.filter((r) => r._metadataManaged)).toHaveLength(1)
    })
})
