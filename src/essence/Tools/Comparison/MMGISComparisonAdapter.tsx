import React from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import moment from 'moment'
import { ComparisonPanel } from './lib'
import type { ComparisonLayout, ComparisonMode } from './lib/types'
import { useVisibleLayers } from './adapters/useVisibleLayers'
import { useGlobalTime } from './adapters/useGlobalTime'
import {
    enableComparison,
    disableComparison,
    setComparisonLabels,
} from './adapters/handlers'

/**
 * A request from whatever started the comparison for the panel to sit on one of
 * its tabs.
 *
 * Carried as an object rather than a bare mode so each request has its own
 * identity: asking twice for the same tab is two clicks of the same entry
 * point, and the panel may have been moved off that tab in between.
 */
export type ComparisonModeRequest = {
    mode: ComparisonMode
}

export type MMGISComparisonAdapterProps = {
    /** Layer that seeded the comparison (from the layers-list kebab menu). */
    seedLayerId?: string | null
    /** Tab the entry point that started the comparison asked the panel to open on. */
    seedMode?: ComparisonModeRequest | null
    /** Called when the user ends the comparison / closes the panel. */
    onClose?: () => void
}

/** What each side draws, resolved from whichever mode is active. */
type Sides = {
    leftLayers: string[]
    rightLayers: string[]
    leftDate: string | null
    rightDate: string | null
} | null

/** What the map calls each side, either side of the divider. */
type Labels = { left: string; right: string }

/**
 * Joins layer ids into a comparable key. Layer names carry spaces and most
 * punctuation, so the separator is a NUL, which none of them can contain.
 */
const ID_SEPARATOR = '\u0000'

/**
 * How a date is worded in the caption beside the divider. UTC and in the same
 * form the panel's date rows use, so the caption over one half of the map and
 * the row that set it read as the same instant.
 */
const dateLabel = (date: Date) => moment.utc(date).format('MMM D, YYYY')

/**
 * Stateful adapter for the Comparison plugin. Owns the side selection in both
 * modes — a layer each in layers mode, a date each in dates mode — keeps the
 * dropdown options and the global timeline in sync, and drives the core
 * comparison capability through the event bus. Renders the MMGIS-agnostic
 * ComparisonPanel.
 */
export function MMGISComparisonAdapter({
    seedLayerId = null,
    seedMode = null,
    onClose,
}: MMGISComparisonAdapterProps) {
    const { layers, read: layersRead } = useVisibleLayers()
    const time = useGlobalTime()
    const [mode, setMode] = useState<ComparisonMode>('layers')
    const [layout, setLayout] = useState<ComparisonLayout>('swipe')
    const [leftLayerId, setLeftLayerId] = useState<string | null>(seedLayerId)
    const [rightLayerId, setRightLayerId] = useState<string | null>(null)
    const [compareDate, setCompareDate] = useState<Date | null>(null)
    // Whether the two choices draw on the opposite sides of the divider from
    // the ones the panel lists them beside. One flag for both modes, because
    // the panel offers one swap button; the choices themselves — the two
    // dropdowns, the two dates — stay where the user set them either way.
    const [swapped, setSwapped] = useState(false)
    const enabledRef = useRef(false)
    // Set once the user exits. The plugin loader tears this root down after
    // `onClose` returns rather than during it, so a layer event arriving in
    // that window would otherwise re-engage comparison on a closed panel.
    const closedRef = useRef(false)

    // Adopt a new seed layer if the panel is re-seeded from another kebab click.
    useEffect(() => {
        if (seedLayerId) setLeftLayerId(seedLayerId)
    }, [seedLayerId])

    // Open on the tab whichever entry point started the comparison asked for.
    // Each request is its own object, so a repeat of the same tab still moves
    // the panel back to it; between requests the tab stays where the user left
    // it.
    useEffect(() => {
        if (seedMode) setMode(seedMode.mode)
    }, [seedMode])

    // The visible-layer hook rebuilds its array on every layer event, even when
    // the set is unchanged, and each fresh identity would re-fire the enable
    // effect below and re-clone both sides for nothing. Deriving the ids from a
    // joined key holds that identity steady until the set itself changes.
    const layerIdsKey = layers.map((layer) => layer.id).join(ID_SEPARATOR)
    const layerIds = useMemo(
        () => (layerIdsKey === '' ? [] : layerIdsKey.split(ID_SEPARATOR)),
        [layerIdsKey],
    )

    // A comparison reads two drawn layers, which is why the layers list disables
    // its Compare entry for a switched-off one. A side whose layer stops being
    // drawn therefore gives it up, ending the comparison. Gated on the first
    // read, since an empty list before it would take the seed with it.
    useEffect(() => {
        if (!layersRead) return
        const drawn = new Set(layerIds)
        setLeftLayerId((id) => (id && !drawn.has(id) ? null : id))
        setRightLayerId((id) => (id && !drawn.has(id) ? null : id))
    }, [layersRead, layerIds])

    /**
     * What the active mode asks the map for, or null when it is not ready to
     * draw yet.
     *
     * Dates mode hands *every* visible layer to both sides, not just the
     * time-enabled ones: core hides the primary map's data layers while
     * comparison is on, so a layer given to neither side would vanish. Handing
     * both sides the same set keeps static layers drawn identically either side
     * of the divider, and only the time-enabled ones differ.
     *
     * The primary side sends no date. Core has already reloaded those layers
     * for the global instant, so cloning them as they stand is both correct and
     * cheaper than recomputing the same URLs.
     *
     * The global instant itself is deliberately not an input here. `time:changed`
     * fires before TimeControl finishes reloading the time-enabled layers, so
     * recomputing the sides from it would clone those layers in their pre-reload
     * state. Core carries the finished reload through to both sides instead,
     * which is why moving the timeline must not re-enable from here.
     */
    const sides: Sides = useMemo(() => {
        if (mode === 'dates') {
            if (!compareDate || layerIds.length === 0) return null
            const pinned = compareDate.toISOString()
            return {
                leftLayers: layerIds,
                rightLayers: layerIds,
                leftDate: swapped ? pinned : null,
                rightDate: swapped ? null : pinned,
            }
        }
        if (!leftLayerId || !rightLayerId) return null
        return {
            leftLayers: [swapped ? rightLayerId : leftLayerId],
            rightLayers: [swapped ? leftLayerId : rightLayerId],
            leftDate: null,
            rightDate: null,
        }
    }, [mode, compareDate, swapped, layerIds, leftLayerId, rightLayerId])

    /**
     * What the map writes either side of the divider: the layer each side
     * draws, or the date it is pinned to. Swap flips the wording along with the
     * sides, so a caption always names the half of the map it sits over.
     *
     * Unlike `sides`, this reads the global instant. A caption is chrome over
     * the finished render, so it can follow the timeline as the user moves it
     * without any layer being rebuilt for the wording.
     */
    const labels: Labels = useMemo(() => {
        const order = (first: string, second: string) =>
            swapped
                ? { left: second, right: first }
                : { left: first, right: second }

        if (mode === 'dates') {
            return order(
                time.current ? dateLabel(time.current) : '',
                compareDate ? dateLabel(compareDate) : '',
            )
        }
        const titleOf = (id: string | null) =>
            (id && layers.find((layer) => layer.id === id)?.title) || ''
        return order(titleOf(leftLayerId), titleOf(rightLayerId))
    }, [mode, swapped, layers, leftLayerId, rightLayerId, time.current, compareDate])

    // Read by the enable effect below, which must not re-run — and re-clone
    // both sides — just because the wording changed.
    const labelsRef = useRef(labels)
    labelsRef.current = labels

    // Drive the core capability whenever the selection or the layout changes.
    // Core preserves the divider position across re-enables and rebuilds only
    // what a layout switch actually invalidates, so re-enabling on every change
    // is safe and keeps both sides current. A layout picked before the sides
    // are settled simply rides in on the first enable.
    useEffect(() => {
        if (closedRef.current) return
        if (sides) {
            // Assumes core applies enables in call order: every handler between
            // the event bus and the deck adapter runs synchronously, so the
            // later of two rapid changes wins. Were any of them to become
            // genuinely asynchronous, that would have to be sequenced here.
            void enableComparison({
                ...sides,
                leftLabel: labelsRef.current.left,
                rightLabel: labelsRef.current.right,
                layout,
            })
            enabledRef.current = true
        } else if (enabledRef.current) {
            void disableComparison()
            enabledRef.current = false
        }
    }, [sides, layout])

    // Keep the captions current on their own. Declared after the effect above
    // so a first enable has already put the chrome up by the time this runs,
    // which is also why it can leave a comparison that is off alone.
    useEffect(() => {
        if (closedRef.current || !enabledRef.current) return
        void setComparisonLabels(labels)
    }, [labels.left, labels.right])

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
        setSwapped((s) => !s)
    }, [])

    const handleClose = useCallback(() => {
        closedRef.current = true
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
            timeEnabled={time.enabled}
            timeStatus={time.readiness}
            layout={layout}
            onLayoutChange={setLayout}
            layers={layers}
            leftLayerId={leftLayerId}
            rightLayerId={rightLayerId}
            onLeftLayerChange={setLeftLayerId}
            onRightLayerChange={setRightLayerId}
            timeWindowStart={time.start}
            timeWindowEnd={time.end}
            primaryDate={time.current}
            compareDate={compareDate}
            onPrimaryDateChange={time.setCurrent}
            onCompareDateChange={setCompareDate}
            swapped={swapped}
            onSwap={handleSwap}
            onClose={handleClose}
        />
    )
}
