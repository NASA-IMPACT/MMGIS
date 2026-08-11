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
 *
 *   Provides (auto-prefixed plugin:aoi:):
 *     - getCurrentSelection -> { feature, source } | null
 *
 *   Listens to:
 *     - map:drawstart / drawvertex /
 *       drawcomplete / drawcancel         (engine bus)
 *     - map:featureClick                  (inspect-mode boundary clicks, filtered by layerId)
 *     - plugin:fetch-stats:analysisProgress  { done, total }
 *     - plugin:fetch-stats:analysisReady     { analysisData }
 *     - plugin:fetch-stats:analysisSkipped   { reason }
 *
 *   Requests:
 *     - map:createLayer / map:removeLayer
 *     - map:getBounds / map:fitBounds
 *     - map:enableDrawing / map:disableDrawing / map:finishDrawing
 *     - map:showPopup      (resolves with how the popup closed) / map:hidePopup
 *
 * AOIComponent.tsx must stay MMGIS-agnostic.
 */

import React from 'react'
import { createRoot } from 'react-dom/client'

import AOIComponent from './AOIComponent'
import {
    buildSearchIndex,
    searchIndex,
    parseGeoJSONText,
    parseKMLText,
    parseShapefileBuffer,
    featureCentroid,
    featureBounds,
    selectionFitBounds,
    selectionTooltipAnchor,
} from './aoiHelpers'
import { loadBoundaries } from './aoiBoundaryLoader'

// ── Plugin identity / layer ids ────────────────────────────────────────────────
const PLUGIN_ID = 'aoi'
const DEFAULT_DRAW_SHAPES = ['polygon', 'rectangle', 'circle']
const VALID_DRAW_SHAPES = new Set(['point', 'linestring', 'polygon', 'rectangle', 'circle'])
const SELECTION_LAYER_ID = 'aoi:selection'
const INSPECT_BOUNDARIES_LAYER_ID = 'aoi:inspect-boundaries'

// ── Draw-session keys ──────────────────────────────────────────────────────────
// Components with these roles handle Escape themselves — a dialog, menu,
// listbox or combobox closes on it — so a key pressed anywhere inside one of
// them is theirs, not the drawing session's.
const KEY_OWNING_ROLE_SELECTOR =
    '[role="dialog"],[role="menu"],[role="listbox"],[role="combobox"]'

// ── Styles ─────────────────────────────────────────────────────────────────────
// The map is handed concrete colors: these end up on SVG presentation
// attributes, which do not resolve var(). So a token is read off :root and
// passed by value — and read at the moment a layer is drawn, not at module
// load, since the theme bundle is fetched at runtime and may not have applied
// yet when this file is first evaluated.
const themeToken = (name, fallback) => {
    if (typeof window === 'undefined' || !window.getComputedStyle) return fallback
    const value = window
        .getComputedStyle(document.documentElement)
        .getPropertyValue(name)
        .trim()
    return value || fallback
}

// The chosen area, in the accent the panel uses for a selected control.
const selectionStyle = () => {
    const color = themeToken('--theme-color-primary', '#1c67e3')
    return { color, weight: 2, fillColor: color, fillOpacity: 0.25 }
}

// The boundaries offered for picking: the same accent a step lighter, and far
// thinner, so the mesh reads as a guide under the selection rather than
// competing with it.
const inspectStyle = () => {
    const color = themeToken('--theme-color-primary-light', '#288bff')
    return { color, weight: 1, fillColor: color, fillOpacity: 0.06 }
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

/** Render a label as text inside the popup's html field. */
function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
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
    _drawKeyHandler: null,
    // Cancels the deferred popup show while the camera is still moving.
    _pendingPopup: null,

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
            subscribe('map:drawstart',     () => this._onDrawStart())
            subscribe('map:drawvertex',    (e) => this._onDrawVertex(e))
            subscribe('map:drawcomplete',  (e) => this._onDrawComplete(e))
            subscribe('map:drawcancel',    () => this._onDrawCancelEvent())
            subscribe('map:featureClick',  (info) => this._onMapFeatureClick(info))
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

        this._cancelPendingPopup()

        // Fire-and-forget: cancel any active drawing session via the bus.
        this._removeDrawKeys()
        window.mmgisAPI?.request?.('map:disableDrawing').catch(() => { })

        this._removeSelectionLayer()
        this._hideInspectBoundaries()
        this._hidePopup()

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
        window.mmgisAPI?.request?.('map:enableDrawing', { shape })
            .catch((err) => console.warn('[AOI] enableDrawing failed', err))
    },

    _onDrawStart() {
        this._installDrawKeys()
        this._setState({ isDrawing: true, drawVerticesCount: 0 })
    },

    /**
     * Enter and Escape belong to the session this plugin started, and the panel
     * hints promise both from anywhere. The engine only hears keys while the
     * map element has focus, so listen on the document for as long as the
     * session lasts and drive it over the bus. Keys typed into a field are the
     * field's, and so are keys pressed inside a component that closes on
     * Escape (see {@link KEY_OWNING_ROLE_SELECTOR}).
     */
    _installDrawKeys() {
        if (this._drawKeyHandler) return
        this._drawKeyHandler = (evt) => {
            if (evt.repeat) return
            const target = evt.target
            const tag = target?.tagName
            if (
                target?.isContentEditable ||
                tag === 'INPUT' ||
                tag === 'TEXTAREA' ||
                tag === 'SELECT' ||
                target?.closest?.(KEY_OWNING_ROLE_SELECTOR)
            ) return
            if (evt.key === 'Escape') {
                window.mmgisAPI?.request?.('map:disableDrawing').catch(() => { })
            } else if (evt.key === 'Enter') {
                window.mmgisAPI?.request?.('map:finishDrawing').catch(() => { })
            }
        }
        document.addEventListener('keydown', this._drawKeyHandler)
    },

    _removeDrawKeys() {
        if (!this._drawKeyHandler) return
        document.removeEventListener('keydown', this._drawKeyHandler)
        this._drawKeyHandler = null
    },

    _onDrawVertex(e) {
        const count = Array.isArray(e?.vertices) ? e.vertices.length : 0
        this._setState({ drawVerticesCount: count })
    },

    _onDrawComplete(e) {
        this._removeDrawKeys()
        this._setState({ isDrawing: false, drawShape: null, drawVerticesCount: 0 })
        const feature = e?.feature
        if (!feature) return
        const label = feature.properties?.shape
            ? `Drawn ${feature.properties.shape}`
            : 'Drawn area'
        this._applySelection(feature, 'draw', label)
    },

    _onDrawCancelEvent() {
        this._removeDrawKeys()
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
                style: inspectStyle(),
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
        this._cancelPendingPopup()
        this._removeSelectionLayer()
        // Retract the current popup up front: the click that starts a new
        // selection would otherwise dismiss it a task later, which answers
        // its request as a dismissal and clears the selection just made.
        this._hidePopup()

        const api = window.mmgisAPI
        api?.request?.('map:createLayer', {
            id: SELECTION_LAYER_ID,
            type: 'vector',
            geojson: { type: 'FeatureCollection', features: [feature] },
            style: selectionStyle(),
            interactive: false,
        }).catch((err) => console.warn('[AOI] failed to add selection layer', err))

        this._state.currentAOI = { feature, source, label }
        this._api?.emit('areaDrawn', { feature, source })

        const c = featureCentroid(feature)
        // `view` keeps the popup on-screen when the camera does not move; omit
        // it once the camera has been fitted to the selection.
        const showPopup = (view) => {
            if (c) {
                this._showPopup(
                    label,
                    selectionTooltipAnchor({ lat: c[1], lng: c[0] }, view)
                )
            }
        }

        const bbox = featureBounds(feature)
        if (bbox && api?.request && api?.on && api?.off) {
            // This popup is pending from here on, before the camera is even
            // read: reading it is asynchronous, and a teardown or a superseding
            // selection during that hop has to drop this popup rather than let
            // it open later. `disarm` is filled in only if the show ends up
            // waiting on the camera.
            let disarm = null
            const cancel = () => disarm?.()
            this._pendingPopup = cancel

            // Pass a view to `showPopup` only when the camera never moved. Once
            // fitBounds has framed the selection, its centroid is on-screen and
            // needs no fallback anchor.
            const settled = (unmovedView) => {
                // Only the pending show that is still current may fire, so a
                // moveend, the fallback timer and a rejected fitBounds arbitrate
                // to one popup, and a superseded selection opens none at all.
                if (this._pendingPopup !== cancel) return
                this._cancelPendingPopup()
                showPopup(unmovedView)
            }

            // Leave the camera alone unless the selection extends beyond the
            // current view; then fit its extent minimally (selectionFitBounds).
            api.request('map:getBounds')
                .catch(() => null)
                .then((view) => {
                    if (this._pendingPopup !== cancel) return
                    const fit = selectionFitBounds(bbox, view)
                    if (!fit) {
                        // The camera stays put, so no moveend is coming and
                        // there is nothing to wait for: open the popup now,
                        // anchored so it cannot land off-screen.
                        settled(view)
                        return
                    }
                    // Defer the popup until the fitBounds animation settles so
                    // it opens at the final centroid pixel instead of tracking
                    // through the camera move.
                    //
                    // `map:moveend` hands its listener a view state
                    // ({ longitude, latitude, zoom }), not a ViewBounds, so this
                    // wrapper drops that payload rather than pass it on.
                    const oneShot = () => settled()
                    // Safety net: if no moveend fires (e.g. an engine that skips
                    // the event on a programmatic fit), show the popup after a
                    // short timeout anyway.
                    const timer = setTimeout(oneShot, 1500)
                    api.on('map:moveend', oneShot)
                    disarm = () => {
                        clearTimeout(timer)
                        api.off('map:moveend', oneShot)
                    }

                    api.request('map:fitBounds', fit).catch((err) => {
                        console.warn('[AOI] fitBounds failed', err)
                        // The fit never happened, so the view read a moment ago
                        // is still the one on screen: anchor against it.
                        settled(view)
                    })
                })
                .catch((err) =>
                    console.warn('[AOI] selection camera step failed', err)
                )
        } else {
            showPopup()
        }
    },

    /** Drop a popup that is still waiting for the camera to settle. */
    _cancelPendingPopup() {
        if (!this._pendingPopup) return
        this._pendingPopup()
        this._pendingPopup = null
    },

    _clearSelection() {
        if (!this._state.currentAOI) return
        this._removeSelectionLayer()
        this._cancelPendingPopup()
        this._state.currentAOI = null
        this._api?.emit('drawingCleared', {})
        this._render()
    },

    _removeSelectionLayer() {
        // removeLayer is idempotent; no need for a hasLayer pre-check.
        window.mmgisAPI?.request?.('map:removeLayer', { id: SELECTION_LAYER_ID })
            .catch(() => { })
    },

    // ── Popup ──────────────────────────────────────────────────────────────────

    /**
     * Ask core for the analyze/cancel popup at a feature centroid. The request
     * is data only — core owns the DOM, the styling and the lifecycle — and it
     * answers with how the popup closed.
     */
    _showPopup(label, latlng) {
        window.mmgisAPI?.request?.('map:showPopup', {
            latlng,
            html: `<strong>${escapeHtml(label)}</strong>`,
            secondaryAction: { label: 'Cancel' },
            primaryAction: { label: 'Analyze area' },
        })
            .then(({ action } = {}) => {
                // Cancel, the X and a click on the map all abandon the
                // selection; 'closed' means AOI itself retracted the popup,
                // which leaves the selection alone.
                if (action === 'primary') this._onAnalyze()
                else if (action === 'secondary' || action === 'dismiss') {
                    this._clearSelection()
                }
            })
            .catch((err) => console.warn('[AOI] showPopup failed', err))
    },

    _hidePopup() {
        window.mmgisAPI?.request?.('map:hidePopup').catch(() => { })
    },

    // ── Analysis hand-off ──────────────────────────────────────────────────────

    /**
     * The popup's result carries no data, so the feature is attached here:
     * `analysisAOIReady` is what reaches the FetchStats and Chart plugins.
     */
    _onAnalyze() {
        const aoi = this._state.currentAOI
        if (!aoi) return
        this._api?.emit('analysisAOIReady', { feature: aoi.feature })
    },

}

export default AOITool
