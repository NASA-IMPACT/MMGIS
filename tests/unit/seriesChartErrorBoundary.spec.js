import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { CardErrorBoundary } from '../../src/essence/Tools/SeriesChart/lib/components/SeriesChartPanel'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function Bomb({ armed }) {
    if (armed) throw new Error('boom')
    return React.createElement('span', null, 'recovered')
}

describe('SeriesChart CardErrorBoundary', () => {
    let host
    let root
    let errorSpy

    beforeEach(() => {
        host = document.createElement('div')
        document.body.appendChild(host)
        root = createRoot(host)
        // React logs the caught error; keep the test output clean.
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
        errorSpy.mockRestore()
    })

    const render = (armed, resetOn) =>
        act(() =>
            root.render(
                React.createElement(
                    CardErrorBoundary,
                    { resetOn },
                    React.createElement(Bomb, { armed }),
                ),
            ),
        )

    test('a throwing card renders the error state instead of unmounting', () => {
        render(true, 'state-1')
        expect(host.textContent).toContain('Could not render this chart.')
    })

    test('a fresh card state retries the render', () => {
        render(true, 'state-1')
        expect(host.textContent).toContain('Could not render this chart.')
        render(false, 'state-2')
        expect(host.textContent).toBe('recovered')
    })

    test('the same card state does not retry', () => {
        const state = { status: 'ready' }
        render(true, state)
        render(false, state)
        expect(host.textContent).toContain('Could not render this chart.')
    })
})
