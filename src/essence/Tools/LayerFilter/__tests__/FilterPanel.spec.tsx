import React from 'react'
import { describe, test, expect, afterEach } from 'vitest'
import { FilterPanel } from '../lib/geo/FilterPanel/FilterPanel'
import type { ThemeDef } from '../lib/types'
import type { EntryDisplay } from '../lib/utils/entryDisplay'
import { mount, type Mounted } from '../../_shared/__tests__/reactHarness'

const THEME: ThemeDef = {
    id: 'event',
    title: 'Event',
    catalog: 'activations',
    filters: [{ id: 'activation', from: 'catalog', isEntry: true }],
}

const display = (over: Partial<EntryDisplay>): EntryDisplay => ({
    id: 'e1',
    title: 'Winter Weather January 2026',
    yearBadge: '2025',
    dateRange: 'Nov 27, 2025 – Feb 5, 2026',
    isActive: false,
    egisUrl: null,
    ...over,
})

let mounted: Mounted | null = null
afterEach(async () => {
    await mounted?.unmount()
    mounted = null
})

const render = async (entry: EntryDisplay) => {
    mounted = await mount(
        <FilterPanel
            theme={THEME}
            selections={{ activation: 'e1' }}
            optionsByFilter={{ activation: [{ value: 'e1', count: 1 }] }}
            entriesById={{ e1: entry }}
            onChange={() => {}}
        />,
    )
    return mounted.container
}

describe('FilterPanel picked-entry EGIS link', () => {
    test('renders a new-tab link beside the dates when egisUrl is set', async () => {
        const url = 'https://gis.earthdata.nasa.gov/portal/home/group.html?id=abc'
        const c = await render(display({ egisUrl: url }))
        const meta = c.querySelector('.blocks-layer-filter__entry-meta')!
        expect(meta.textContent).toContain('Nov 27, 2025 – Feb 5, 2026')
        const a = meta.querySelector<HTMLAnchorElement>(
            'a.blocks-layer-filter__entry-link',
        )!
        expect(a.getAttribute('href')).toBe(url)
        expect(a.getAttribute('target')).toBe('_blank')
        expect(a.getAttribute('rel')).toContain('noopener')
        expect(a.textContent).toBe('View GIS Services')
    })

    test('renders no link when egisUrl is null', async () => {
        const c = await render(display({}))
        expect(c.querySelector('.blocks-layer-filter__entry-meta')).not.toBeNull()
        expect(c.querySelector('.blocks-layer-filter__entry-link')).toBeNull()
    })

    test('shows the meta row for a link even without a date range', async () => {
        const c = await render(display({ dateRange: '', egisUrl: 'https://x.test/g' }))
        expect(c.querySelector('.blocks-layer-filter__entry-dates')).toBeNull()
        expect(c.querySelector('.blocks-layer-filter__entry-link')).not.toBeNull()
    })
})
