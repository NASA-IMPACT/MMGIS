import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildProfile } from '../src/profileBuilder.js'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('buildProfile', () => {
    it('bases the profile on minimal.json with mission name applied', () => {
        const p = buildProfile({ missionName: 'AQ Atlanta' }, repoRoot)
        expect(p.scaffold.msv.mission).toBe('AQ Atlanta')
        expect(p.scaffold.msv.missionFolderName).toBe('AQ Atlanta')
        expect(p.tools).toContain('Title')
        expect(p.tools).toContain('LayerManager')
        expect(p.output).toBeUndefined()
    })
    it('applies view as a string triple and pageName', () => {
        const p = buildProfile(
            { missionName: 'M', view: { lat: 33.75, lon: -84.39, zoom: 10 }, pageName: 'Air Quality' },
            repoRoot
        )
        expect(p.scaffold.msv.view).toEqual(['33.75', '-84.39', '10'])
        expect(p.scaffold.look.pagename).toBe('Air Quality')
    })
    it('mints uuids for layers that lack one and fills envelope defaults', () => {
        const p = buildProfile(
            { missionName: 'M', layers: [{ name: 'NO2', type: 'TileLayer', url: 'https://t/{z}/{x}/{y}.png' }] },
            repoRoot
        )
        const layer = p.scaffold.layers[0]
        expect(layer.uuid).toMatch(/^[0-9a-f-]{36}$/)
        expect(layer.sublayers).toEqual([])
        expect(layer.visibility).toBe(true)
        expect(layer.name).toBe('NO2')
    })
    it('merges extra tools and overrides without dropping the minimal set', () => {
        const p = buildProfile(
            { missionName: 'M', tools: ['Chart'], on: ['Chart'], overrides: { Chart: { variables: { a: 1 } } } },
            repoRoot
        )
        expect(p.tools).toEqual(expect.arrayContaining(['Title', 'LayerManager', 'Chart']))
        expect(p.on).toContain('Chart')
        expect(p.overrides.Chart.variables.a).toBe(1)
    })
})
