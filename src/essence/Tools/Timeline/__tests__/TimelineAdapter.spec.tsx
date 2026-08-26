import React, { act } from 'react'
import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import { createRoot, type Root } from 'react-dom/client'
import { TimelineAdapter } from '../TimelineAdapter'

/**
 * The timeline's "Compare date" action is a hand-off, not a call: the timeline
 * knows nothing about the Comparison plugin beyond the name of the event it
 * announces, and a mission without that plugin is simply one where nobody
 * listens. What is covered here is that the action is offered at all and that
 * clicking it puts that event on the bus.
 */

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true

const START = '2024-01-01T00:00:00Z'
const END = '2024-12-31T00:00:00Z'
const CURRENT = '2024-06-15T00:00:00Z'

type Emit = { event: string; payload?: unknown }

describe('TimelineAdapter compare hand-off', () => {
    let container: HTMLElement
    let root: Root
    let emits: Emit[]

    beforeEach(async () => {
        emits = []
        ;(window as unknown as { mmgisAPI: unknown }).mmgisAPI = {
            request: async (name: string) => {
                if (name === 'time:isEnabled') return true
                if (name === 'time:getStart') return START
                if (name === 'time:getEnd') return END
                if (name === 'time:getCurrent') return CURRENT
                if (name === 'tool:getVars') return {}
                return null
            },
            hasHandler: (name: string) => name !== 'layers:getAllConfigs',
            on: () => () => {},
            emit: (event: string, payload?: unknown) => {
                emits.push({ event, payload })
            },
        }

        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
        await act(async () => {
            root.render(<TimelineAdapter />)
        })
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
        delete (window as { mmgisAPI?: unknown }).mmgisAPI
    })

    const compareButton = () =>
        container.querySelector<HTMLButtonElement>('.compare-date-button')

    test('offers the compare action beside the date', () => {
        expect(compareButton()).not.toBeNull()
    })

    test('clicking it announces the hand-off on the bus', () => {
        act(() => {
            compareButton()!.click()
        })

        expect(
            emits.filter((e) => e.event === 'plugin:comparison:startWithDates'),
        ).toHaveLength(1)
    })
})
