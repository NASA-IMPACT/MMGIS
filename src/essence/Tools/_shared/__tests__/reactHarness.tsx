/**
 * Minimal mount/act helpers for the plugin's React specs.
 *
 * The repo has no React testing library, and a bare harness suits these specs
 * anyway: mounting through `react-dom/client` and nothing else leaves no
 * test-time provider to quietly stand in for a host.
 */

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// React's scheduler checks this before any root exists; setting it at import
// time keeps act() from warning and makes updates flush synchronously.
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true

export type Mounted = {
    container: HTMLElement
    rerender: (ui: React.ReactElement) => Promise<void>
    unmount: () => Promise<void>
}

export const mount = async (ui: React.ReactElement): Promise<Mounted> => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    let root: Root | null = null
    await act(async () => {
        root = createRoot(container)
        root.render(ui)
    })
    return {
        container,
        rerender: async (next: React.ReactElement) => {
            await act(async () => {
                root?.render(next)
            })
        },
        unmount: async () => {
            await act(async () => {
                root?.unmount()
            })
            container.remove()
        },
    }
}

/** Mount a hook inside a throwaway component and expose its latest return. */
export const mountHook = async <T,>(
    useHook: () => T,
): Promise<Mounted & { result: { current: T } }> => {
    const result = { current: undefined as T }
    const Probe = () => {
        result.current = useHook()
        return null
    }
    const mounted = await mount(<Probe />)
    return { ...mounted, result }
}

/** Dispatch a bubbling click, which is what React's root listener sees. */
export const click = async (element: Element): Promise<void> => {
    await act(async () => {
        element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
}
