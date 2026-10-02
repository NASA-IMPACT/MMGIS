import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MMGISLayerFilterAdapter } from '../../src/essence/Tools/LayerFilter/MMGISLayerFilterAdapter'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

function makeBus(configs) {
    const handlers = {}
    const asked = []
    return {
        asked,
        hasHandler: () => true,
        on(event, h) {
            ;(handlers[event] ||= []).push(h)
            return () => {
                handlers[event] = handlers[event].filter((x) => x !== h)
            }
        },
        emit(event, payload) {
            ;(handlers[event] || []).forEach((h) => h(payload))
        },
        async request(name) {
            asked.push(name)
            if (name === 'layers:getAllConfigs') return configs()
            return null
        },
    }
}

describe('MMGISLayerFilterAdapter', () => {
    let host
    let root
    let bus
    let configs

    beforeEach(async () => {
        configs = { a: { type: 'tile', properties: {} } }
        bus = makeBus(() => structuredClone(configs))
        window.mmgisAPI = bus
        host = document.createElement('div')
        document.body.appendChild(host)
        root = createRoot(host)
        await act(async () =>
            root.render(React.createElement(MMGISLayerFilterAdapter)),
        )
    })

    afterEach(() => {
        act(() => root.unmount())
        host.remove()
        delete window.mmgisAPI
    })

    const configReads = () =>
        bus.asked.filter((name) => name === 'layers:getAllConfigs').length

    test('reads the layer configs once at load', () => {
        expect(configReads()).toBe(1)
    })

    test('reads them again when a layer is added or removed', async () => {
        configs.b = { type: 'vector', properties: {} }
        await act(async () => bus.emit('layers:listChanged'))
        expect(configReads()).toBe(2)
    })
})
