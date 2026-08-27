import React from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, test, expect, vi, afterEach } from 'vitest'

/**
 * The Configure checkbox has a long way to travel: `tool:getVars` -> the
 * adapter's resolved flag -> the `includeLegend` dep the export action reads.
 * Nothing downstream fails loudly when a link in that chain breaks — the
 * export just quietly always (or never) carries a legend — so the chain is
 * asserted end to end here.
 */

const shareActionCalls: { name: string; deps: { includeLegend?: boolean } }[] = []

vi.mock('../../_shared/adapters/shareActions', () => ({
    copyShareLink: async () => 'https://mmgis/?v=1',
    downloadSharePng: async (deps = {}) => {
        shareActionCalls.push({ name: 'png', deps })
        return null
    },
    downloadSharePdf: async (deps = {}) => {
        shareActionCalls.push({ name: 'pdf', deps })
        return null
    },
}))

// The presentational menu is replaced by a probe that hands back the
// callbacks, so the spec drives the adapter's handlers directly rather than
// through the dropdown's DOM.
let menuProps: { onDownloadPng?: () => void; onDownloadPdf?: () => void } = {}
vi.mock('../lib', () => ({
    ShareMenu: (props: typeof menuProps) => {
        menuProps = props
        return null
    },
}))

const { MMGISShareExportAdapter } = await import('../MMGISShareExportAdapter')

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true

const setVars = (vars: Record<string, unknown>) => {
    window.mmgisAPI = {
        request: async (name: string) =>
            name === 'tool:getVars' ? vars : null,
        hasHandler: (name: string) => name === 'tool:getVars',
        on: () => () => {},
        emit: () => {},
    } as unknown as Window['mmgisAPI']
}

const mountAdapter = async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    await act(async () => {
        createRoot(container).render(<MMGISShareExportAdapter />)
    })
}

describe('MMGISShareExportAdapter includeLegend wiring', () => {
    afterEach(() => {
        shareActionCalls.length = 0
        menuProps = {}
        delete window.mmgisAPI
    })

    test('passes the resolved flag into both export actions', async () => {
        setVars({})
        await mountAdapter()
        await act(async () => {
            menuProps.onDownloadPng?.()
        })
        await act(async () => {
            menuProps.onDownloadPdf?.()
        })
        expect(shareActionCalls).toEqual([
            { name: 'png', deps: { includeLegend: true } },
            { name: 'pdf', deps: { includeLegend: true } },
        ])
    })

    // Configure persists an unchecked checkbox as the string 'false'.
    test("a saved 'false' turns the legend off for the export", async () => {
        setVars({ includeLegend: 'false' })
        await mountAdapter()
        await act(async () => {
            menuProps.onDownloadPng?.()
        })
        expect(shareActionCalls).toEqual([
            { name: 'png', deps: { includeLegend: false } },
        ])
    })

    test('a saved false boolean turns the legend off for the export', async () => {
        setVars({ includeLegend: false })
        await mountAdapter()
        await act(async () => {
            menuProps.onDownloadPdf?.()
        })
        expect(shareActionCalls).toEqual([
            { name: 'pdf', deps: { includeLegend: false } },
        ])
    })
})
