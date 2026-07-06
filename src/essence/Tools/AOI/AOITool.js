/**
 * AOI plugin — MMGIS wrapper.
 *
 * Pluggable contract (see specs/012-aoi-plugin/plan.md and PLUGIN-DEVELOPMENT-GUIDE.md):
 *
 *   pluginId: 'aoi'
 *
 *   Emits  (auto-prefixed plugin:aoi:):
 *     - areaDrawn          { feature, source: 'search'|'draw'|'upload'|'inspect' }
 *     - analysisAOIReady   { feature }   — consumed by the FetchStats plugin
 *     - drawingCleared     {}
 *     - drawingCancelled   {}
 *
 *   Provides (auto-prefixed plugin:aoi:):
 *     - getCurrentSelection -> { feature, source } | null
 *
 *   Listens to:
 *     - tool:change                       (core)
 *     - map:drawstart / drawvertex /
 *       drawcomplete / drawcancel         (engine bus)
 *     - map:featureClick                  (inspect-mode boundary clicks, filtered by layerId)
 *     - plugin:fetch-stats:analysisProgress  { done, total }
 *     - plugin:fetch-stats:analysisReady     { analysisData }
 *     - plugin:fetch-stats:analysisSkipped   { reason }
 *
 *   Requests:
 *     - map:createLayer / map:removeLayer
 *     - map:fitBounds
 *     - map:enableDrawing / map:finishDrawing / map:disableDrawing
 *     - map:addOverlay / map:removeOverlay

 * AOIComponent.tsx and AOITooltip.tsx must stay MMGIS-agnostic.
 */

import React from 'react'
import { createRoot } from 'react-dom/client'

import AOIComponent from './AOIComponent'
import AOITooltip from './AOITooltip'
import {
    buildSearchIndex,
    searchIndex,
    parseGeoJSONText,
    parseKMLText,
    parseShapefileBuffer,
    featureCentroid,
    featureBounds,
} from './aoiHelpers'
import { loadBoundaries } from './aoiBoundaryLoader'

// ── Plugin identity / layer ids ────────────────────────────────────────────────
const PLUGIN_ID = 'aoi'
const DEFAULT_DRAW_SHAPES = ['polygon', 'rectangle', 'circle']
const VALID_DRAW_SHAPES = new Set(['point', 'linestring', 'polygon', 'rectangle', 'circle'])
const SELECTION_LAYER_ID = 'aoi:selection'
const INSPECT_BOUNDARIES_LAYER_ID = 'aoi:inspect-boundaries'
const TOOLTIP_OVERLAY_ID = 'aoi:tooltip'

// ── Styles ─────────────────────────────────────────────────────────────────────
const SELECTION_STYLE = {
    color: '#005ea2',
    weight: 3,
    fillColor: '#005ea2',
    fillOpacity: 0.25,
}

const INSPECT_STYLE = {
    color: '#137480',
    weight: 1,
    fillColor: '#137480',
    fillOpacity: 0.06,
}

const initialState = () => ({
    mode: 'search',
    searchQuery: '',
    searchAllEntries: [],
    searchResults: [],
    searchLoading: false,
    searchDisabled: false,
    drawShape: null,
    drawDisabled: false,
    isDrawing: false,
    drawVerticesCount: 0,
    uploadStatus: 'idle',
    uploadError: '',
    currentAOI: null,
    analysisStatus: 'idle',
    analysisLabel: '',
    analysisDone: 0,
    analysisTotal: 0,
    analysisError: null,
})

/**
 * Bbox area of a GeoJSON feature, used to order overlapping polygons so
 * smaller ones (states) sit on top of larger ones (country) for picking.
 * Returns 0 when bounds can't be computed.
 */
function bboxArea(feature) {
    const b = featureBounds(feature)
    if (!b) return 0
    return (b[2] - b[0]) * (b[3] - b[1])
}

const AOITool = {
    // height:0 + width:0 makes ToolController_ collapse the docked side rail to 0px.
    height: 0,
    width: 0,
    made: false,
    targetId: null,
    _reactRoot: null,
    _state: initialState(),
    _cleanups: [],
    _api: null,
    _analysisErrorTimeout: null,

    // ── Lifecycle ──────────────────────────────────────────────────────────────

    make(targetId) {
        this.targetId = typeof targetId === 'string' ? targetId : 'toolPanel'
        const container = document.getElementById(this.targetId)
        if (!container) {
            console.error(`AOITool: container ${this.targetId} not found`)
            return
        }
        this._reactRoot = createRoot(container)

        this._api =
            (typeof window !== 'undefined' && window.mmgisAPI?.forPlugin?.(PLUGIN_ID)) ||
            { emit: () => { }, provide: () => () => { } }

        this._cleanups.push(
            this._api.provide('getCurrentSelection', () => this._state.currentAOI)
        )

        this._state.searchLoading = true
        loadBoundaries()
            .then((boundaries) => {
                this._setState({
                    searchAllEntries: buildSearchIndex(boundaries),
                    searchLoading: false,
                })
                if (this._state.mode === 'inspect') {
                    this._showInspectBoundaries()
                }
            })
            .catch((err) => {
                console.warn('[AOI] failed to load bundled boundaries', err)
                this._setState({ searchLoading: false, searchDisabled: true })
            })

        const api = window.mmgisAPI
        if (api?.on) {
            const subscribe = (event, handler) => {
                const off = api.on(event, handler)
                this._cleanups.push(typeof off === 'function' ? off : () => { })
            }
            subscribe('tool:change', () => this._clearSelection())
            subscribe('map:drawstart', (e) => this._onDrawStart(e))
            subscribe('map:drawvertex', (e) => this._onDrawVertex(e))
            subscribe('map:drawcomplete', (e) => this._onDrawComplete(e))
            subscribe('map:drawcancel', () => this._onDrawCancelEvent())
            subscribe('map:featureClick', (info) => this._onMapFeatureClick(info))
            subscribe('plugin:fetch-stats:analysisProgress', ({ done, total }) => {
                if (done === 0) {
                    this._setState({
                        analysisStatus: 'running',
                        analysisLabel: this._state.currentAOI?.label || 'Area of interest',
                        analysisDone: 0,
                        analysisTotal: total,
                    })
                } else {
                    this._setState({ analysisDone: done })
                }
            })
            subscribe('plugin:fetch-stats:analysisReady', () => {
                this._setState({ analysisStatus: 'idle' })
            })
            subscribe('plugin:fetch-stats:analysisSkipped', ({ reason } = {}) => {
                this._showAnalysisError(this._messageForSkipReason(reason))
            })
        }

        this._render()
        this.made = true
    },

    destroy() {
        this._cleanups.forEach((fn) => {
            try {
                fn()
            } catch {
                // intentionally swallow — destroy must remain idempotent
            }
        })
        this._cleanups = []

        if (this._analysisErrorTimeout) {
            clearTimeout(this._analysisErrorTimeout)
            this._analysisErrorTimeout = null
        }

        // Fire-and-forget: cancel any active drawing session via the bus.
        window.mmgisAPI?.request?.('map:disableDrawing').catch(() => { })

        this._removeSelectionLayer()
        this._hideInspectBoundaries()
        this._hideTooltip()

        if (this._reactRoot) {
            this._reactRoot.unmount()
            this._reactRoot = null
        }
        this.targetId = null

        this._state = initialState()
        this._api = null
        this.made = false
    },

    getUrlString() {
        return ''
    },

    // ── Rendering ──────────────────────────────────────────────────────────────

    _setState(patch) {
        this._state = { ...this._state, ...patch }
        this._render()
    },

    /**
     * Resolve the configured Draw-shape allowlist from the mission's AOI
     * tool variables. Accepts either an array (`textarray` config field) or
     * a comma-separated string, trims/normalises entries, and drops any
     * value not in the supported set. Falls back to a sensible default when
     * unset or empty.
     */
    _resolveDrawShapes() {
        const raw = this._api?.getVars?.()?.drawShapes
        const list = Array.isArray(raw)
            ? raw
            : typeof raw === 'string'
                ? raw.split(',')
                : null
        if (!list) return DEFAULT_DRAW_SHAPES
        const cleaned = list
            .map((s) => String(s).trim().toLowerCase())
            .filter((s) => VALID_DRAW_SHAPES.has(s))
        return cleaned.length ? cleaned : DEFAULT_DRAW_SHAPES
    },

    /**
     * Surface a transient inline error in the AOI panel. Auto-dismisses after
     * 8s so the user isn't stuck looking at stale feedback; the user can also
     * dismiss it manually via {@link _dismissAnalysisError}.
     */
    _showAnalysisError(message) {
        if (!message) return
        if (this._analysisErrorTimeout) {
            clearTimeout(this._analysisErrorTimeout)
        }
        this._setState({ analysisError: message })
        this._analysisErrorTimeout = setTimeout(() => {
            this._analysisErrorTimeout = null
            this._setState({ analysisError: null })
        }, 8000)
    },

    _dismissAnalysisError() {
        if (this._analysisErrorTimeout) {
            clearTimeout(this._analysisErrorTimeout)
            this._analysisErrorTimeout = null
        }
        this._setState({ analysisError: null })
    },

    /**
     * Map a `plugin:fetch-stats:analysisSkipped.reason` to a user-facing message.
     * Unknown reasons get a generic fallback.
     */
    _messageForSkipReason(reason) {
        if (reason === 'no-eligible-layers') {
            return 'No analyzable layer is currently visible. Toggle on a layer with analysis support and try again.'
        }
        return 'Analysis could not run.'
    },

    _render() {
        if (!this._reactRoot) return
        this._reactRoot.render(
            React.createElement(AOIComponent, {
                mode: this._state.mode,
                onModeChange: (mode) => this._onModeChange(mode),

                searchQuery: this._state.searchQuery,
                searchResults: this._state.searchResults,
                searchDisabled: this._state.searchDisabled,
                searchLoading: this._state.searchLoading,
                onSearchQueryChange: (q) => this._onSearchQueryChange(q),
                onSearchSelect: (id) => this._onSearchSelect(id),

                drawShape: this._state.drawShape,
                drawShapes: this._resolveDrawShapes(),
                drawDisabled: this._state.drawDisabled,
                isDrawing: this._state.isDrawing,
                drawVerticesCount: this._state.drawVerticesCount,
                onDrawShapeChange: (drawShape) => this._onDrawShapeChange(drawShape),
                onDrawConfirm: () => this._onDrawConfirm(),
                onDrawCancel: () => this._onDrawCancel(),

                uploadStatus: this._state.uploadStatus,
                uploadError: this._state.uploadError,
                onUploadFile: (file) => this._onUploadFile(file),

                analysisStatus: this._state.analysisStatus,
                analysisLabel: this._state.analysisLabel,
                analysisDone: this._state.analysisDone,
                analysisTotal: this._state.analysisTotal,
                analysisError: this._state.analysisError,
                onDismissAnalysisError: () => this._dismissAnalysisError(),

                onClose: () => this._onClose(),
            })
        )
    },

    // ── Mode switching ─────────────────────────────────────────────────────────

    _onModeChange(nextMode) {
        const prev = this._state.mode
        if (prev === nextMode) return

        if (prev === 'inspect') this._hideInspectBoundaries()
        if (nextMode === 'inspect') this._showInspectBoundaries()

        if (prev === 'draw') {
            // Cancel any in-flight drawing session when leaving Draw mode.
            // The bus handler is a no-op if no session is active.
            window.mmgisAPI?.request?.('map:disableDrawing').catch(() => { })
        }

        this._setState({ mode: nextMode })
    },

    _onClose() {
        window.mmgisAPI?.emit('core:unloadPlugin', { pluginId: 'AOITool' })
    },

    // ── Search mode ────────────────────────────────────────────────────────────

    _onSearchQueryChange(q) {
        this._setState({
            searchQuery: q,
            searchResults: searchIndex(q, this._state.searchAllEntries),
        })
    },

    _onSearchSelect(id) {
        const entry = this._state.searchAllEntries.find((e) => e.id === id)
        if (!entry) return
        this._applySelection(entry.feature, 'search', entry.label)
    },

    // ── Draw mode ──────────────────────────────────────────────────────────────

    _onDrawShapeChange(shape) {
        this._setState({ drawShape: shape, drawVerticesCount: 0 })
        window.mmgisAPI?.request?.('map:enableDrawing', {
            shape,
            options: { style: SELECTION_STYLE },
        }).catch((err) => console.warn('[AOI] enableDrawing failed', err))
    },

    _onDrawConfirm() {
        window.mmgisAPI?.request?.('map:finishDrawing')
            .catch((err) => console.warn('[AOI] finishDrawing failed', err))
    },

    _onDrawCancel() {
        window.mmgisAPI?.request?.('map:disableDrawing')
            .catch((err) => console.warn('[AOI] disableDrawing failed', err))
    },

    _onDrawStart() {
        this._setState({ isDrawing: true, drawVerticesCount: 0 })
    },

    _onDrawVertex(e) {
        const count = Array.isArray(e?.vertices) ? e.vertices.length : 0
        this._setState({ drawVerticesCount: count })
    },

    _onDrawComplete(e) {
        this._setState({ isDrawing: false, drawShape: null, drawVerticesCount: 0 })
        const feature = e?.feature
        if (!feature) return
        const label = feature.properties?.shape
            ? `Drawn ${feature.properties.shape}`
            : 'Drawn area'
        this._applySelection(feature, 'draw', label)
    },

    _onDrawCancelEvent() {
        this._setState({ isDrawing: false, drawShape: null, drawVerticesCount: 0 })
    },

    // ── Inspect mode ───────────────────────────────────────────────────────────

    _showInspectBoundaries() {
        const entries = this._state.searchAllEntries
        if (!entries.length) return
        const api = window.mmgisAPI
        if (!api?.request) return

        // Sort largest-area first so big polygons (e.g. "United States") render
        // first and small ones (states) end up on top. Deck.gl picks the
        // topmost feature, so this ensures a click in Alabama returns Alabama,
        // not the country polygon that contains it.
        const features = entries
            .map((e) => e.feature)
            .slice()
            .sort((a, b) => bboxArea(b) - bboxArea(a))

        // Drop any prior layer first; createLayer is not idempotent.
        api.request('map:removeLayer', { id: INSPECT_BOUNDARIES_LAYER_ID })
            .catch(() => { })
            .then(() => api.request('map:createLayer', {
                id: INSPECT_BOUNDARIES_LAYER_ID,
                type: 'vector',
                geojson: {
                    type: 'FeatureCollection',
                    features,
                },
                style: INSPECT_STYLE,
                interactive: true,
            }))
            .catch((err) => console.warn('[AOI] failed to show inspect boundaries', err))
    },

    _hideInspectBoundaries() {
        window.mmgisAPI?.request?.('map:removeLayer', { id: INSPECT_BOUNDARIES_LAYER_ID })
            .catch(() => { })
    },

    _onMapFeatureClick(info) {
        if (this._state.mode !== 'inspect') return
        if (info?.layerId !== INSPECT_BOUNDARIES_LAYER_ID) return
        const feature = info?.feature
        if (!feature?.geometry) return
        const gtype = feature.geometry.type
        if (gtype !== 'Polygon' && gtype !== 'MultiPolygon') return
        const props = feature.properties || {}
        const label =
            props.name ||
            props.NAME ||
            props.title ||
            (props._aoiKind ? `Inspected ${props._aoiKind}` : 'Inspected area')
        this._applySelection(feature, 'inspect', label)
    },

    // ── Upload mode ────────────────────────────────────────────────────────────

    _onUploadFile(file) {
        this._setState({ uploadStatus: 'parsing', uploadError: '' })
        const reader = new FileReader()
        const name = file.name || ''
        const isShapefile = /\.(zip|shp)$/i.test(name)
        const isKml = /\.kml$/i.test(name)

        reader.onerror = () => {
            this._setState({ uploadStatus: 'error', uploadError: 'Could not read file.' })
        }

        const applyResult = (result) => {
            if (!result.feature) {
                this._setState({
                    uploadStatus: 'error',
                    uploadError: result.error || 'Could not parse file.',
                })
                return
            }
            const props = result.feature.properties || {}
            const label = props.name || props.NAME || props.title || name
            this._setState({ uploadStatus: 'idle', uploadError: '' })
            this._applySelection(result.feature, 'upload', String(label))
        }

        reader.onload = () => {
            if (isShapefile) {
                parseShapefileBuffer(reader.result).then(applyResult).catch((err) => {
                    this._setState({
                        uploadStatus: 'error',
                        uploadError: err?.message || 'Could not parse shapefile.',
                    })
                })
                return
            }
            const text = String(reader.result || '')
            applyResult(isKml ? parseKMLText(text) : parseGeoJSONText(text))
        }

        if (isShapefile) {
            reader.readAsArrayBuffer(file)
        } else {
            reader.readAsText(file)
        }
    },

    // ── Selection lifecycle ────────────────────────────────────────────────────

    _applySelection(feature, source, label) {
        this._removeSelectionLayer()

        const api = window.mmgisAPI
        api?.request?.('map:createLayer', {
            id: SELECTION_LAYER_ID,
            type: 'vector',
            geojson: { type: 'FeatureCollection', features: [feature] },
            style: SELECTION_STYLE,
            interactive: false,
        }).catch((err) => console.warn('[AOI] failed to add selection layer', err))

        this._state.currentAOI = { feature, source, label }
        this._api?.emit('areaDrawn', { feature, source })

        const c = featureCentroid(feature)
        const showTooltip = () => {
            if (c) {
                this._showTooltip({
                    label,
                    latlng: { lat: c[1], lng: c[0] },
                    analyzeEnabled: true,
                })
            }
        }

        const bbox = featureBounds(feature)
        if (bbox && api?.on && api?.off) {
            // Defer the tooltip until the fitBounds animation settles so it
            // mounts at the final centroid pixel instead of flickering through
            // intermediate positions during the camera move.
            let fallback
            const oneShot = () => {
                api.off('map:moveend', oneShot)
                clearTimeout(fallback)
                showTooltip()
            }
            api.on('map:moveend', oneShot)
            // Belt-and-braces: if no moveend fires (e.g. already at target view),
            // show the tooltip after a short timeout anyway.
            fallback = setTimeout(oneShot, 1500)

            api.request('map:fitBounds', {
                bounds: [
                    { lat: bbox[1], lng: bbox[0] },
                    { lat: bbox[3], lng: bbox[2] },
                ],
                options: { padding: 120, maxZoom: 5 },
            }).catch((err) => {
                console.warn('[AOI] fitBounds failed', err)
                oneShot()
            })
        } else {
            showTooltip()
        }
    },

    _clearSelection() {
        if (!this._state.currentAOI) return
        this._removeSelectionLayer()
        this._hideTooltip()
        this._state.currentAOI = null
        this._api?.emit('drawingCleared', {})
        this._render()
    },

    _removeSelectionLayer() {
        // removeLayer is idempotent; no need for a hasLayer pre-check.
        window.mmgisAPI?.request?.('map:removeLayer', { id: SELECTION_LAYER_ID })
            .catch(() => { })
    },

    // ── Tooltip overlay ────────────────────────────────────────────────────────

    /**
     * Show the analyze/cancel tooltip anchored to a feature centroid.
     * Core's `map:addOverlay` owns the DOM and repositions on view change.
     */
    _showTooltip({ label, latlng, analyzeEnabled }) {
        const api = window.mmgisAPI
        if (!api?.request) return
        api.request('map:addOverlay', {
            id: TOOLTIP_OVERLAY_ID,
            latlng,
            mount: (node) => {
                const tooltipRoot = createRoot(node)
                tooltipRoot.render(
                    React.createElement(AOITooltip, {
                        label,
                        position: { x: 0, y: 0 },
                        analyzeEnabled,
                        onAnalyze: () => this._onAnalyze(),
                        onCancel: () => this._onCancel(),
                    })
                )
                return () => tooltipRoot.unmount()
            },
        }).catch((err) => console.warn('[AOI] addOverlay failed', err))
    },

    _hideTooltip() {
        window.mmgisAPI?.request?.('map:removeOverlay', { id: TOOLTIP_OVERLAY_ID })
            .catch(() => { })
    },

    // ── Analysis hand-off ──────────────────────────────────────────────────────

    _onAnalyze() {
        const aoi = this._state.currentAOI
        if (!aoi) return
        this._api?.emit('analysisAOIReady', { feature: aoi.feature })
        this._hideTooltip()
    },

    _onCancel() {
        this._api?.emit('drawingCancelled', {})
        this._clearSelection()
    },

}

export default AOITool
