/**
 * AOI plugin — MMGIS wrapper.
 *
 * Pluggable contract (see specs/012-aoi-plugin/plan.md and PLUGIN-DEVELOPMENT-GUIDE.md):
 *
 *   pluginId: 'aoi'
 *
 *   Emits  (auto-prefixed plugin:aoi:):
 *     - selectionChanged   { feature, source: 'search'|'draw'|'upload'|'inspect' }
 *     - analysisRequested  { feature, layerName }
 *     - analysisCancelled  {}
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

import { mapEngineRegistry } from '../../Basics/MapEngines'

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
    tooltip: null,
})

const AOITool = {
    // height:0 + width:0 makes ToolController_ collapse the docked side rail to 0px.
    height: 0,
    width: 0,
    MMGISInterface: null,
    _root: null,
    _tooltipRoot: null,
    _state: initialState(),
    _cleanups: [],
    _api: null,
    _engineHandlers: {
        reposition: null,
        drawstart: null,
        drawvertex: null,
        drawcomplete: null,
        drawcancel: null,
    },

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

        if (window.mmgisAPI?.on) {
            const off = window.mmgisAPI.on('tool:change', () => this._clearSelection())
            this._cleanups.push(typeof off === 'function' ? off : () => { })
        }

        this._engineHandlers.reposition = () => this._repositionTooltip()
        this._engineHandlers.drawstart = (e) => this._onDrawStart(e)
        this._engineHandlers.drawvertex = (e) => this._onDrawVertex(e)
        this._engineHandlers.drawcomplete = (e) => this._onDrawComplete(e)
        this._engineHandlers.drawcancel = () => this._onDrawCancelEvent()

        const engine = this._engine()
        if (engine) {
            engine.on('move', this._engineHandlers.reposition)
            engine.on('moveend', this._engineHandlers.reposition)
            engine.on('drawstart', this._engineHandlers.drawstart)
            engine.on('drawvertex', this._engineHandlers.drawvertex)
            engine.on('drawcomplete', this._engineHandlers.drawcomplete)
            engine.on('drawcancel', this._engineHandlers.drawcancel)
            if (typeof engine.onFeatureClick === 'function') {
                engine.onFeatureClick((result) => this._onMapFeatureClick(result))
            }
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

        const engine = this._engine()
        if (engine) {
            if (typeof engine.isDrawing === 'function' && engine.isDrawing()) {
                try {
                    engine.disableDrawing()
                } catch {
                    // intentionally swallow
                }
            }
            if (this._engineHandlers.reposition) {
                engine.off('move', this._engineHandlers.reposition)
                engine.off('moveend', this._engineHandlers.reposition)
            }
            if (this._engineHandlers.drawstart)
                engine.off('drawstart', this._engineHandlers.drawstart)
            if (this._engineHandlers.drawvertex)
                engine.off('drawvertex', this._engineHandlers.drawvertex)
            if (this._engineHandlers.drawcomplete)
                engine.off('drawcomplete', this._engineHandlers.drawcomplete)
            if (this._engineHandlers.drawcancel)
                engine.off('drawcancel', this._engineHandlers.drawcancel)
        }
        this._engineHandlers = {
            reposition: null,
            drawstart: null,
            drawvertex: null,
            drawcomplete: null,
            drawcancel: null,
        }

        this._removeSelectionLayer()
        this._hideInspectBoundaries()

        if (this._tooltipRoot) {
            unmountComponentAtNode(this._tooltipRoot)
            if (this._tooltipRoot.parentNode)
                this._tooltipRoot.parentNode.removeChild(this._tooltipRoot)
            this._tooltipRoot = null
        }
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
        this._renderTooltip()
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

    _renderTooltip() {
        if (!this._tooltipRoot) return
        const t = this._state.tooltip
        if (!t) {
            unmountComponentAtNode(this._tooltipRoot)
            return
        }
        render(
            React.createElement(AOITooltip, {
                label: t.label,
                position: t.position,
                analyzeEnabled: t.analyzeEnabled,
                onAnalyze: () => this._onAnalyze(),
                onCancel: () => this._onCancel(),
            }),
            this._tooltipRoot
        )
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
        const engine = this._engine()
        if (!engine || typeof engine.enableDrawing !== 'function') {
            console.warn('[AOI] Drawing not supported on the active engine')
            return
        }
        this._setState({ drawShape: shape, drawVerticesCount: 0 })
        try {
            engine.enableDrawing(shape, { style: SELECTION_STYLE })
        } catch (err) {
            console.warn('[AOI] enableDrawing failed', err)
        }
    },

    _onDrawConfirm() {
        const engine = this._engine()
        if (!engine || !engine.isDrawing?.()) return
        try {
            engine.finishDrawing()
        } catch (err) {
            console.warn('[AOI] finishDrawing failed', err)
        }
    },

    _onDrawCancel() {
        const engine = this._engine()
        if (!engine || !engine.isDrawing?.()) return
        try {
            engine.disableDrawing()
        } catch (err) {
            console.warn('[AOI] disableDrawing failed', err)
        }
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

        const engine = this._engine()
        if (engine) {
            try {
                engine.createLayer({
                    id: SELECTION_LAYER_ID,
                    type: 'vector',
                    geojson: { type: 'FeatureCollection', features: [feature] },
                    style: SELECTION_STYLE,
                    interactive: false,
                })
            } catch (err) {
                console.warn('[AOI] failed to add selection layer', err)
            }
            const bbox = featureBounds(feature)
            if (bbox) {
                try {
                    engine.fitBounds(
                        [
                            { lat: bbox[1], lng: bbox[0] },
                            { lat: bbox[3], lng: bbox[2] },
                        ],
                        { padding: 120, maxZoom: 5 }
                    )
                } catch (err) {
                    console.warn('[AOI] fitBounds failed', err)
                }
            }
        }

        const aoi = { feature, source }
        this._state.currentAOI = aoi
        this._api?.emit('selectionChanged', aoi)

        const tooltip = this._buildTooltipState(feature, label)
        this._setState({ tooltip })
    },

    _clearSelection() {
        if (!this._state.currentAOI && !this._state.tooltip) return
        this._removeSelectionLayer()
        this._state.currentAOI = null
        this._api?.emit('selectionChanged', { feature: null, source: 'inspect' })
        this._setState({ tooltip: null })
    },

    _removeSelectionLayer() {
        const engine = this._engine()
        if (!engine) return
        try {
            if (engine.hasLayer(SELECTION_LAYER_ID)) {
                engine.removeLayer(SELECTION_LAYER_ID)
            }
        } catch {
            // intentionally swallow
        }
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

        const engine = this._engine()
        if (prev === 'draw' && engine?.isDrawing?.()) {
            try {
                engine.disableDrawing()
            } catch {
                // intentionally swallow
            }
        }

        this._setState({ mode: nextMode })
    },

    _showInspectBoundaries() {
        const engine = this._engine()
        if (!engine) return
        const entries = this._state.searchAllEntries
        if (!entries.length) return
        try {
            if (engine.hasLayer(INSPECT_BOUNDARIES_LAYER_ID)) {
                engine.removeLayer(INSPECT_BOUNDARIES_LAYER_ID)
            }
            engine.createLayer({
                id: INSPECT_BOUNDARIES_LAYER_ID,
                type: 'vector',
                geojson: {
                    type: 'FeatureCollection',
                    features: entries.map((e) => e.feature),
                },
                style: INSPECT_STYLE,
                interactive: true,
            })
        } catch (err) {
            console.warn('[AOI] failed to show inspect boundaries', err)
        }
    },

    _hideInspectBoundaries() {
        const engine = this._engine()
        if (!engine) return
        try {
            if (engine.hasLayer(INSPECT_BOUNDARIES_LAYER_ID)) {
                engine.removeLayer(INSPECT_BOUNDARIES_LAYER_ID)
            }
        } catch {
            // intentionally swallow
        }
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

    _buildTooltipState(feature, label) {
        const c = featureCentroid(feature)
        if (!c) return null
        const engine = this._engine()
        if (!engine) return null
        let position = { x: 0, y: 0 }
        try {
            const px = engine.latLngToContainerPoint({ lat: c[1], lng: c[0] })
            position = pointToXY(px)
        } catch {
            return null
        }
        return {
            label,
            position,
            analyzeEnabled: true,
            _latLng: { lat: c[1], lng: c[0] },
        }
    },

    _repositionTooltip() {
        const t = this._state.tooltip
        if (!t) return
        const engine = this._engine()
        if (!engine) return
        try {
            const px = engine.latLngToContainerPoint(t._latLng)
            const next = { ...t, position: pointToXY(px) }
            this._state.tooltip = next
            this._renderTooltip()
        } catch {
            // intentionally swallow stale projections during init
        }
    },

    _onAnalyze() {
        const aoi = this._state.currentAOI
        if (!aoi) return
        const layerName = this._guessActiveLayerName()
        const payload = { feature: aoi.feature, layerName }
        const eventName = `plugin:${PLUGIN_ID}:analysisRequested`

        console.log('[AOI] Sending to Analysis plugin (chart):', {
            event: eventName,
            payload,
            source: aoi.source,
        })
        this._api?.emit('analysisRequested', payload)
        console.log(`[AOI] Emitted: ${eventName}`)

        this._setState({ tooltip: null })
    },

    _onCancel() {
        this._api?.emit('analysisCancelled', {})
        this._clearSelection()
    },

    _guessActiveLayerName() {
        return null
    },

    _onClose() {
        const btn = document.getElementById('toolButtonAOI')
        if (btn) btn.click()
    },

    _engine() {
        try {
            return mapEngineRegistry.getActiveEngine()
        } catch {
            return null
        }
    },
}

function pointToXY(p) {
    if (!p) return { x: 0, y: 0 }
    if (Array.isArray(p)) return { x: p[0], y: p[1] }
    return { x: p.x ?? 0, y: p.y ?? 0 }
}

function interfaceWithMMGIS(tool) {
    const root = document.createElement('div')
    root.className = 'aoi-tool-host'
    document.body.appendChild(root)
    tool._root = root

    const engine = tool._engine ? tool._engine() : null
    if (engine && typeof engine.getContainer === 'function') {
        const container = engine.getContainer()
        if (container) {
            const tooltipHost = document.createElement('div')
            tooltipHost.setAttribute('data-aoi-tooltip-host', '')
            tooltipHost.style.position = 'absolute'
            tooltipHost.style.left = '0'
            tooltipHost.style.top = '0'
            tooltipHost.style.right = '0'
            tooltipHost.style.bottom = '0'
            tooltipHost.style.pointerEvents = 'none'
            tooltipHost.style.zIndex = '500'
            container.appendChild(tooltipHost)
            tool._tooltipRoot = tooltipHost
        }
    }

    this.separateFromMMGIS = function () {
        if (tool._root && tool._root.parentNode) {
            tool._root.parentNode.removeChild(tool._root)
        }
    }
}

export default AOITool
