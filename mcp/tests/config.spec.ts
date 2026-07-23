import { describe, it, expect } from 'vitest'
import { loadConfig } from '../src/config.js'

const base = { MMGIS_TOKEN: 'tok123' }

describe('loadConfig', () => {
    it('throws without MMGIS_TOKEN', () => {
        expect(() => loadConfig({})).toThrow(/MMGIS_TOKEN/)
    })
    it('defaults MMGIS_URL to localhost:8888 and strips trailing slashes', () => {
        expect(loadConfig({ ...base }).mmgisUrl).toBe('http://localhost:8888')
        expect(loadConfig({ ...base, MMGIS_URL: 'https://gis.example.com/' }).mmgisUrl).toBe('https://gis.example.com')
    })
    it('derives wsUrl from mmgisUrl unless MMGIS_WS_URL is set', () => {
        expect(loadConfig({ ...base }).wsUrl).toBe('ws://localhost:8888/')
        expect(loadConfig({ ...base, MMGIS_URL: 'https://gis.example.com' }).wsUrl).toBe('wss://gis.example.com/')
        expect(loadConfig({ ...base, MMGIS_WS_URL: 'ws://elsewhere:9000/' }).wsUrl).toBe('ws://elsewhere:9000/')
        expect(loadConfig({ ...base, MMGIS_WS_URL: 'ws://elsewhere:9000' }).wsUrl).toBe('ws://elsewhere:9000/')
    })
    it('parses STAC_CATALOGS JSON and falls back to defaults', () => {
        expect(loadConfig({ ...base, STAC_CATALOGS: '{"mine":"https://stac.me"}' }).stacCatalogs).toEqual({ mine: 'https://stac.me' })
        expect(Object.keys(loadConfig({ ...base }).stacCatalogs)).toContain('veda')
    })
    it('rejects STAC_CATALOGS that parses but is not a {name: url} object', () => {
        expect(() => loadConfig({ ...base, STAC_CATALOGS: '[1,2]' })).toThrow(/STAC_CATALOGS must be/)
        expect(() => loadConfig({ ...base, STAC_CATALOGS: '{"a": 5}' })).toThrow(/STAC_CATALOGS must be/)
    })
    it('resolves repoRoot to the MMGIS checkout by default', () => {
        expect(loadConfig({ ...base }).repoRoot.endsWith('MMGIS')).toBe(true)
    })
})
