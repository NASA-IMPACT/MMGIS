/**
 * AOI plugin — MMGIS wrapper.
 *
 * Pluggable contract (see specs/012-aoi-plugin/plan.md and PLUGIN-DEVELOPMENT-GUIDE.md):
 *
 *   pluginId: 'aoi'
 *
 *   Emits  (auto-prefixed plugin:aoi:):
 *     - areaDrawn          { feature, source: 'search'|'draw'|'upload'|'inspect', layerName }
 *     - analysisAOIReady   { feature }
 *     - drawingCleared     {}
 *     - drawingCancelled   {}
 *
 *   Provides (auto-prefixed plugin:aoi:):
 *     - getCurrentSelection -> { feature, source } | null
 *
 *   Listens to (existing core events):
 *     - tool:change
 *
 *   Requests (existing handlers):
 *     - layers:getVisible
 *
 *   Requests (NOT YET AVAILABLE — see BLOCKERS.md):
 *     - plugin:analysis:supportsLayer  (owned by the Analysis plugin team)
 *
 * This file is the only file in the plugin that imports MMGIS internals.
 * AOIComponent.tsx and AOITooltip.tsx must stay MMGIS-agnostic.
 */

import React from 'react'
import { render, unmountComponentAtNode } from 'react-dom'

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

const PLUGIN_ID = 'aoi'
const SELECTION_LAYER_ID = 'aoi:selection'
const INSPECT_BOUNDARIES_LAYER_ID = 'aoi:inspect-boundaries'

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
})

const TOOLTIP_OVERLAY_ID = 'aoi:tooltip'

const AOITool = {
    // height:0 + width:0 makes ToolController_ collapse the docked side rail to 0px.
    height: 0,
    width: 0,
    MMGISInterface: null,
    _root: null,
    _state: initialState(),
    _cleanups: [],
    _api: null,

    make(targetId) {
        this.MMGISInterface = new interfaceWithMMGIS(this, targetId)

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
            subscribe('tool:change',       () => this._clearSelection())
            subscribe('map:drawstart',     (e) => this._onDrawStart(e))
            subscribe('map:drawvertex',    (e) => this._onDrawVertex(e))
            subscribe('map:drawcomplete',  (e) => this._onDrawComplete(e))
            subscribe('map:drawcancel',    () => this._onDrawCancelEvent())
            subscribe('feature:active',    (result) => this._onMapFeatureClick(result))
            subscribe(`plugin:${PLUGIN_ID}:analysisAOIReady`, () => {
                console.log('Hello there')
            })
        }

        this._render()
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

        // Fire-and-forget: cancel any active drawing session via the bus.
        window.mmgisAPI?.request?.('map:disableDrawing').catch(() => { })

        this._removeSelectionLayer()
        this._hideInspectBoundaries()
        this._hideTooltip()

        if (this._root) {
            unmountComponentAtNode(this._root)
            this._root = null
        }

        if (this.MMGISInterface) {
            this.MMGISInterface.separateFromMMGIS()
            this.MMGISInterface = null
        }

        this._state = initialState()
        this._api = null
    },

    getUrlString() {
        return ''
    },

    _setState(patch) {
        this._state = { ...this._state, ...patch }
        this._render()
    },

    _render() {
        if (!this._root) return
        render(
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
                drawDisabled: this._state.drawDisabled,
                isDrawing: this._state.isDrawing,
                drawVerticesCount: this._state.drawVerticesCount,
                onDrawShapeChange: (drawShape) => this._onDrawShapeChange(drawShape),
                onDrawConfirm: () => this._onDrawConfirm(),
                onDrawCancel: () => this._onDrawCancel(),

                uploadStatus: this._state.uploadStatus,
                uploadError: this._state.uploadError,
                onUploadFile: (file) => this._onUploadFile(file),

                onClose: () => this._onClose(),
            }),
            this._root
        )
    },

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
                render(
                    React.createElement(AOITooltip, {
                        label,
                        position: { x: 0, y: 0 },
                        analyzeEnabled,
                        onAnalyze: () => this._onAnalyze(),
                        onCancel: () => this._onCancel(),
                    }),
                    node
                )
                return () => unmountComponentAtNode(node)
            },
        }).catch((err) => console.warn('[AOI] addOverlay failed', err))
    },

    _hideTooltip() {
        window.mmgisAPI?.request?.('map:removeOverlay', { id: TOOLTIP_OVERLAY_ID })
            .catch(() => { })
    },

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
        const label =
            (feature.properties && feature.properties.shape
                ? `Drawn ${feature.properties.shape}`
                : 'Drawn area')
        this._applySelection(feature, 'draw', label)
    },

    _onDrawCancelEvent() {
        this._setState({ isDrawing: false, drawShape: null, drawVerticesCount: 0 })
    },

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

        const bbox = featureBounds(feature)
        if (bbox) {
            api?.request?.('map:fitBounds', {
                bounds: [
                    { lat: bbox[1], lng: bbox[0] },
                    { lat: bbox[3], lng: bbox[2] },
                ],
                options: { padding: 120, maxZoom: 5 },
            }).catch((err) => console.warn('[AOI] fitBounds failed', err))
        }

        const aoi = { feature, source }
        this._state.currentAOI = aoi
        this._api?.emit('areaDrawn', {
            feature,
            source,
            layerName: this._guessActiveLayerName(),
        })

        const c = featureCentroid(feature)
        if (c) {
            this._showTooltip({
                label,
                latlng: { lat: c[1], lng: c[0] },
                analyzeEnabled: true,
            })
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

    _onModeChange(nextMode) {
        const prev = this._state.mode
        if (prev === nextMode) return

        if (prev === 'inspect') {
            this._hideInspectBoundaries()
        }
        if (nextMode === 'inspect') {
            this._showInspectBoundaries()
        }

        if (prev === 'draw') {
            // Cancel any in-flight drawing session when leaving Draw mode.
            // The bus handler is a no-op if no session is active.
            window.mmgisAPI?.request?.('map:disableDrawing').catch(() => { })
        }

        this._setState({ mode: nextMode })
    },

    _showInspectBoundaries() {
        const entries = this._state.searchAllEntries
        if (!entries.length) return
        const api = window.mmgisAPI
        if (!api?.request) return
        // Drop any prior layer first; createLayer is not idempotent.
        api.request('map:removeLayer', { id: INSPECT_BOUNDARIES_LAYER_ID })
            .catch(() => { })
            .then(() => api.request('map:createLayer', {
                id: INSPECT_BOUNDARIES_LAYER_ID,
                type: 'vector',
                geojson: {
                    type: 'FeatureCollection',
                    features: entries.map((e) => e.feature),
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

    _onMapFeatureClick(result) {
        if (this._state.mode !== 'inspect') return
        const feature = result?.feature
        if (!feature || !feature.geometry) return
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

    _guessActiveLayerName() {
        return null
    },

    _onClose() {
        const btn = document.getElementById('toolButtonAOI')
        if (btn) btn.click()
    },
}

function interfaceWithMMGIS(tool) {
    const root = document.createElement('div')
    root.className = 'aoi-tool-host'
    document.body.appendChild(root)
    tool._root = root

    this.separateFromMMGIS = function () {
        if (tool._root && tool._root.parentNode) {
            tool._root.parentNode.removeChild(tool._root)
        }
    }
}

export default AOITool
