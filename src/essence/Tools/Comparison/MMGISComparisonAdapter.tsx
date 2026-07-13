import React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ComparisonPanel } from './lib'
import type { ComparisonMode } from './lib/types'
import { useVisibleLayers } from './adapters/useVisibleLayers'
import {
    enableComparison,
    disableComparison,
} from './adapters/handlers'

export type MMGISComparisonAdapterProps = {
    /** Layer that seeded the comparison (from the layers-list kebab menu). */
    seedLayerId?: string | null
    /** Called when the user ends the comparison / closes the panel. */
    onClose?: () => void
}

/**
 * Stateful adapter for the Comparison plugin. Owns side selection, keeps the
 * dropdown options in sync with the visible layers, and drives the core swipe
 * capability through the event bus. Renders the MMGIS-agnostic ComparisonPanel.
 */
export function MMGISComparisonAdapter({
    seedLayerId = null,
    onClose,
}: MMGISComparisonAdapterProps) {
    const layers = useVisibleLayers()
    const [mode, setMode] = useState<ComparisonMode>('layers')
    const [leftLayerId, setLeftLayerId] = useState<string | null>(seedLayerId)
    const [rightLayerId, setRightLayerId] = useState<string | null>(null)
    const enabledRef = useRef(false)

    // Adopt a new seed layer if the panel is re-seeded from another kebab click.
    useEffect(() => {
        if (seedLayerId) setLeftLayerId(seedLayerId)
    }, [seedLayerId])

    // Drive the core capability whenever the selection changes. Core preserves
    // the divider position across re-enables, so re-enabling on every change is
    // safe and keeps both sides current.
    useEffect(() => {
        if (leftLayerId && rightLayerId) {
            void enableComparison(leftLayerId, rightLayerId)
            enabledRef.current = true
        } else if (enabledRef.current) {
            void disableComparison()
            enabledRef.current = false
        }
    }, [leftLayerId, rightLayerId])

    // Tear down comparison if the panel unmounts while still active.
    useEffect(() => {
        return () => {
            if (enabledRef.current) {
                void disableComparison()
                enabledRef.current = false
            }
        }
    }, [])

    const handleSwap = useCallback(() => {
        setLeftLayerId(rightLayerId)
        setRightLayerId(leftLayerId)
    }, [leftLayerId, rightLayerId])

    const handleClose = useCallback(() => {
        if (enabledRef.current) {
            void disableComparison()
            enabledRef.current = false
        }
        onClose?.()
    }, [onClose])

    return (
        <ComparisonPanel
            mode={mode}
            onModeChange={setMode}
            datesDisabled
            layers={layers}
            leftLayerId={leftLayerId}
            rightLayerId={rightLayerId}
            onLeftLayerChange={setLeftLayerId}
            onRightLayerChange={setRightLayerId}
            onSwap={handleSwap}
            onClose={handleClose}
        />
    )
}
