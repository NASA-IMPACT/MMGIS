import { describe, test, expect } from 'vitest'
import { buildEntryDisplays } from '../lib/utils/entryDisplay'
import type { CatalogEntry } from '../lib/engine/types'

const entry = (properties: Record<string, unknown>): CatalogEntry => ({
    id: 'e1',
    properties: { title: 'Winter Weather January 2026', ...properties },
    start: '2025-11-27T00:00:00Z',
    end: '2026-02-05T00:00:00Z',
})

describe('buildEntryDisplays egis_url', () => {
    test('passes an http(s) egis_url through as egisUrl', () => {
        const url =
            'https://gis.earthdata.nasa.gov/portal/home/group.html?id=461a5be76a2c4e6db6ec470657a6f9d6#content'
        const shown = buildEntryDisplays([entry({ egis_url: url })])
        expect(shown.e1.egisUrl).toBe(url)
    })

    test('absent egis_url is null', () => {
        expect(buildEntryDisplays([entry({})]).e1.egisUrl).toBeNull()
    })

    test('non-http values are treated as absent', () => {
        for (const bad of ['', 'javascript:alert(1)', 'ftp://x', 42, null, {}]) {
            expect(
                buildEntryDisplays([entry({ egis_url: bad })]).e1.egisUrl,
            ).toBeNull()
        }
    })
})
