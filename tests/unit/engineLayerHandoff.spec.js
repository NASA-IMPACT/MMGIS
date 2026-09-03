import { describe, test, expect, vi } from 'vitest'
import { handOffLayerToEngine } from '../../src/essence/Basics/Layers_/engineLayerHandoff.js'

/**
 * What creation owes the engine.
 *
 * Every layer is handed over as soon as it is built — held and ranked, but
 * not shown. That is what lets an opacity write or a refresh reach a layer
 * that is switched off, so nothing has to be replayed when it is switched on.
 * Before this, deck.gl only learned about a layer at its first switch-on, and
 * everything the layer had been told in between was lost.
 */

const makeEngine = () => ({
    registerLayer: vi.fn(),
    setLayerZIndex: vi.fn(),
    setLayerVisibility: vi.fn(),
})

const order = (fn) => fn.mock.invocationCallOrder[0]

describe('handOffLayerToEngine', () => {
    test('registers the layer under its uuid', () => {
        const engine = makeEngine()
        const layer = { id: 'Flood Extent' }

        handOffLayerToEngine(engine, 'Flood Extent', layer, 3)

        expect(engine.registerLayer).toHaveBeenCalledWith('Flood Extent', layer)
    })

    // Ranked once, here, rather than on every toggle: the rank is derived from
    // the configured stack order and does not change when a checkbox does.
    test('ranks it by uuid, so a layer never shown still has its place', () => {
        const engine = makeEngine()

        handOffLayerToEngine(engine, 'Flood Extent', { id: 'Flood Extent' }, 3)

        expect(engine.setLayerZIndex).toHaveBeenCalledWith('Flood Extent', 3)
        expect(order(engine.setLayerZIndex)).toBeGreaterThan(
            order(engine.registerLayer)
        )
    })

    // Visibility is stated here rather than left for a later pass to
    // correct, because a builder can trigger that pass itself before
    // returning — so a layer handed over hidden could stay hidden.
    test('hands over a configured-on layer already visible', () => {
        const engine = makeEngine()

        handOffLayerToEngine(engine, 'Flood Extent', { id: 'Flood Extent' }, 3, true)

        expect(engine.setLayerVisibility).toHaveBeenCalledWith(
            'Flood Extent',
            true
        )
    })

    test('hands over a configured-off layer hidden', () => {
        const engine = makeEngine()

        handOffLayerToEngine(engine, 'Flood Extent', { id: 'Flood Extent' }, 3, false)

        expect(engine.setLayerVisibility).toHaveBeenCalledWith(
            'Flood Extent',
            false
        )
    })

    // Nothing said means nothing shown: a caller that does not know had
    // better not guess a layer onto the screen.
    test('hands it over hidden when no visibility is given', () => {
        const engine = makeEngine()

        handOffLayerToEngine(engine, 'Flood Extent', { id: 'Flood Extent' }, 3)

        expect(engine.setLayerVisibility).toHaveBeenCalledWith(
            'Flood Extent',
            false
        )
    })

    // Registering is the moment an engine could start drawing — and, for a
    // tile layer, requesting tiles. Nothing else may come between the two.
    test('hides it before doing anything else with it', () => {
        const engine = makeEngine()

        handOffLayerToEngine(engine, 'Flood Extent', { id: 'Flood Extent' }, 3)

        expect(order(engine.setLayerVisibility)).toBeGreaterThan(
            order(engine.registerLayer)
        )
        expect(order(engine.setLayerVisibility)).toBeLessThan(
            order(engine.setLayerZIndex)
        )
    })

    // Addressed by uuid throughout: the engine's registry is keyed by it, and
    // a native object may carry no id the engine recognises — a Leaflet layer
    // under the deck.gl engine carries none at all.
    test('addresses the engine by uuid, never by the native object', () => {
        const engine = makeEngine()
        const layer = { id: 'something-else' }

        handOffLayerToEngine(engine, 'Flood Extent', layer, 3)

        expect(engine.setLayerZIndex.mock.calls[0][0]).toBe('Flood Extent')
        expect(engine.setLayerVisibility.mock.calls[0][0]).toBe('Flood Extent')
    })

    test('does nothing without an engine', () => {
        expect(() =>
            handOffLayerToEngine(null, 'Flood Extent', { id: 'x' }, 3)
        ).not.toThrow()
    })

    // A layer whose build failed is recorded as null or as the `false`
    // load-failure sentinel. Neither is something an engine can hold.
    test.each([[null], [undefined], [false]])(
        'does nothing for a layer that was not built (%s)',
        (nativeLayer) => {
            const engine = makeEngine()

            handOffLayerToEngine(engine, 'Flood Extent', nativeLayer, 3)

            expect(engine.registerLayer).not.toHaveBeenCalled()
            expect(engine.setLayerZIndex).not.toHaveBeenCalled()
            expect(engine.setLayerVisibility).not.toHaveBeenCalled()
        }
    )
})
