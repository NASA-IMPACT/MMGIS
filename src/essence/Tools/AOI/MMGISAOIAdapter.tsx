import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Feature } from 'geojson'
import { AOIPanel, AOITooltip } from './lib'
import type {
    AOIMode,
    AOIShape,
    AOISearchResult,
    UploadStatus,
    AnalysisStatus,
} from './lib'
import { useMMGISEvent } from './adapters/useMMGISEvent'
import { useMMGISToolVars } from './adapters/useMMGISToolVars'
import { mmgisOn } from '../_shared/adapters/mmgisAPI'
import {
    buildSearchIndex,
    searchIndex,
    type AOISearchEntry,
} from './adapters/search'
import { parseGeoJSONText, parseKMLText, parseShapefileBuffer } from './adapters/parse'
import { featureCentroid, featureBounds } from './adapters/geometry'
import { loadBoundaries } from './aoiBoundaryLoader'
import {
    INSPECT_BOUNDARIES_LAYER_ID,
    OPEN_PANEL_CHANNEL,
    emitAOI,
    provideAOI,
    enableDrawing,
    finishDrawing,
    disableDrawing,
    drawSelection,
    removeSelection,
    showInspectBoundaries,
    hideInspectBoundaries,
    fitToBounds,
    addTooltipOverlay,
    removeTooltipOverlay,
} from './adapters/aoiBus'

const VALID_DRAW_SHAPES = new Set<AOIShape>([
    'point',
    'linestring',
    'polygon',
    'rectangle',
    'circle',
])
const DEFAULT_DRAW_SHAPES: AOIShape[] = ['polygon', 'rectangle', 'circle']

type ToolVars = { drawShapes?: unknown }

function resolveDrawShapes(raw: unknown): AOIShape[] {
    const list = Array.isArray(raw)
        ? raw
        : typeof raw === 'string'
            ? raw.split(',')
            : null
    if (!list) return DEFAULT_DRAW_SHAPES
    const cleaned = list
        .map((s) => String(s).trim().toLowerCase())
        .filter((s): s is AOIShape => VALID_DRAW_SHAPES.has(s as AOIShape))
    return cleaned.length ? cleaned : DEFAULT_DRAW_SHAPES
}

type CurrentAOI = { feature: Feature; source: string; label: string }

export function MMGISAOIAdapter() {
    // The selection panel stays hidden until the Title plugin's "Analyze area"
    // button fires OPEN_PANEL_CHANNEL.
    const [panelVisible, setPanelVisible] = useState(false)
    const [mode, setMode] = useState<AOIMode>('search')
    const [searchQuery, setSearchQuery] = useState('')
    const [searchResults, setSearchResults] = useState<AOISearchResult[]>([])
    const [searchLoading, setSearchLoading] = useState(true)
    const [searchDisabled, setSearchDisabled] = useState(false)
    const [drawShape, setDrawShape] = useState<AOIShape | null>(null)
    const [isDrawing, setIsDrawing] = useState(false)
    const [drawVerticesCount, setDrawVerticesCount] = useState(0)
    const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle')
    const [uploadError, setUploadError] = useState('')
    const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>('idle')
    const [analysisLabel, setAnalysisLabel] = useState('')
    const [analysisDone, setAnalysisDone] = useState(0)
    const [analysisTotal, setAnalysisTotal] = useState(0)
    const [analysisError, setAnalysisError] = useState<string | null>(null)

    const vars = useMMGISToolVars<ToolVars>('aoi')
    const drawShapes = resolveDrawShapes(vars.drawShapes)

    // Refs that event handlers read without re-subscribing.
    const entriesRef = useRef<AOISearchEntry[]>([])
    const currentAOIRef = useRef<CurrentAOI | null>(null)
    const modeRef = useRef<AOIMode>(mode)
    const tooltipRootRef = useRef<Root | null>(null)
    const errorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    useEffect(() => {
        modeRef.current = mode
    }, [mode])

    // ── getCurrentSelection provider ─────────────────────────────────────────
    useEffect(() => {
        const off = provideAOI('getCurrentSelection', () => currentAOIRef.current)
        return off
    }, [])

    // ── Load bundled boundaries once ──────────────────────────────────────────
    useEffect(() => {
        let cancelled = false
        loadBoundaries()
            .then((boundaries) => {
                if (cancelled) return
                entriesRef.current = buildSearchIndex(boundaries)
                setSearchLoading(false)
                if (modeRef.current === 'inspect') {
                    showInspectBoundaries(entriesRef.current.map((e) => e.feature))
                }
            })
            .catch((err) => {
                if (cancelled) return
                console.warn('[AOI] failed to load bundled boundaries', err)
                setSearchLoading(false)
                setSearchDisabled(true)
            })
        return () => {
            cancelled = true
        }
    }, [])

    // ── Tooltip ───────────────────────────────────────────────────────────────
    const hideTooltip = useCallback(() => {
        removeTooltipOverlay()
        if (tooltipRootRef.current) {
            tooltipRootRef.current.unmount()
            tooltipRootRef.current = null
        }
    }, [])

    const clearSelection = useCallback(() => {
        if (!currentAOIRef.current) return
        removeSelection()
        hideTooltip()
        currentAOIRef.current = null
        emitAOI('drawingCleared', {})
    }, [hideTooltip])

    const showTooltip = useCallback(
        (label: string, latlng: { lat: number; lng: number }) => {
            addTooltipOverlay(latlng, (node) => {
                const root = createRoot(node)
                tooltipRootRef.current = root
                root.render(
                    <AOITooltip
                        label={label}
                        position={{ x: 0, y: 0 }}
                        analyzeEnabled
                        onAnalyze={() => {
                            const aoi = currentAOIRef.current
                            if (aoi) emitAOI('analysisAOIReady', { feature: aoi.feature })
                            hideTooltip()
                        }}
                        onCancel={() => {
                            emitAOI('drawingCancelled', {})
                            clearSelection()
                        }}
                    />,
                )
                return () => {
                    root.unmount()
                    if (tooltipRootRef.current === root) tooltipRootRef.current = null
                }
            })
        },
        [hideTooltip, clearSelection],
    )

    // ── Selection lifecycle ────────────────────────────────────────────────────
    const applySelection = useCallback(
        (feature: Feature, source: string, label: string) => {
            removeSelection()
            drawSelection(feature)
            currentAOIRef.current = { feature, source, label }
            emitAOI('areaDrawn', { feature, source })

            const c = featureCentroid(feature)
            const doShow = () => {
                if (c) showTooltip(label, { lat: c[1], lng: c[0] })
            }

            const bbox = featureBounds(feature)
            if (bbox) {
                // Defer the tooltip until the fitBounds animation settles.
                let fallback: ReturnType<typeof setTimeout>
                const oneShot = () => {
                    off()
                    clearTimeout(fallback)
                    doShow()
                }
                const off = mmgisOn('map:moveend', oneShot)
                fallback = setTimeout(oneShot, 1500)
                fitToBounds(bbox).catch(() => oneShot())
            } else {
                doShow()
            }
        },
        [showTooltip],
    )

    // ── Mode handlers ──────────────────────────────────────────────────────────
    const onModeChange = useCallback((next: AOIMode) => {
        setMode((prev) => {
            if (prev === next) return prev
            if (prev === 'inspect') hideInspectBoundaries()
            if (next === 'inspect') showInspectBoundaries(entriesRef.current.map((e) => e.feature))
            if (prev === 'draw') disableDrawing()
            return next
        })
    }, [])

    // Closing only hides the panel — the adapter stays mounted so it keeps
    // listening for the next OPEN_PANEL_CHANNEL from the Title plugin.
    const onClose = useCallback(() => {
        setPanelVisible(false)
    }, [])

    // ── Search ──────────────────────────────────────────────────────────────────
    const onSearchQueryChange = useCallback((q: string) => {
        setSearchQuery(q)
        setSearchResults(
            searchIndex(q, entriesRef.current).map((e) => ({
                id: e.id,
                label: e.label,
                kind: e.kind,
            })),
        )
    }, [])

    const onSearchSelect = useCallback(
        (id: string) => {
            const entry = entriesRef.current.find((e) => e.id === id)
            if (entry) applySelection(entry.feature, 'search', entry.label)
        },
        [applySelection],
    )

    // ── Draw ──────────────────────────────────────────────────────────────────
    const onDrawShapeChange = useCallback((shape: AOIShape) => {
        setDrawShape(shape)
        setDrawVerticesCount(0)
        enableDrawing(shape)
    }, [])
    const onDrawConfirm = useCallback(() => finishDrawing(), [])
    const onDrawCancel = useCallback(() => disableDrawing(), [])

    // ── Upload ──────────────────────────────────────────────────────────────────
    const onUploadFile = useCallback(
        (file: File) => {
            setUploadStatus('parsing')
            setUploadError('')
            const reader = new FileReader()
            const name = file.name || ''
            const isShapefile = /\.(zip|shp)$/i.test(name)
            const isKml = /\.kml$/i.test(name)

            const applyResult = (result: { feature: Feature | null; error?: string }) => {
                if (!result.feature) {
                    setUploadStatus('error')
                    setUploadError(result.error || 'Could not parse file.')
                    return
                }
                const props = (result.feature.properties || {}) as Record<string, unknown>
                const label =
                    (props.name as string) ||
                    (props.NAME as string) ||
                    (props.title as string) ||
                    name
                setUploadStatus('idle')
                setUploadError('')
                applySelection(result.feature, 'upload', String(label))
            }

            reader.onerror = () => {
                setUploadStatus('error')
                setUploadError('Could not read file.')
            }
            reader.onload = () => {
                if (isShapefile) {
                    parseShapefileBuffer(reader.result as ArrayBuffer)
                        .then(applyResult)
                        .catch((err) => {
                            setUploadStatus('error')
                            setUploadError(err?.message || 'Could not parse shapefile.')
                        })
                    return
                }
                const text = String(reader.result || '')
                applyResult(isKml ? parseKMLText(text) : parseGeoJSONText(text))
            }

            if (isShapefile) reader.readAsArrayBuffer(file)
            else reader.readAsText(file)
        },
        [applySelection],
    )

    // ── Analysis error toast ───────────────────────────────────────────────────
    const showAnalysisError = useCallback((message: string) => {
        if (!message) return
        if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current)
        setAnalysisError(message)
        errorTimeoutRef.current = setTimeout(() => {
            errorTimeoutRef.current = null
            setAnalysisError(null)
        }, 8000)
    }, [])
    const dismissAnalysisError = useCallback(() => {
        if (errorTimeoutRef.current) {
            clearTimeout(errorTimeoutRef.current)
            errorTimeoutRef.current = null
        }
        setAnalysisError(null)
    }, [])

    // ── Bus subscriptions ────────────────────────────────────────────────────
    useMMGISEvent(OPEN_PANEL_CHANNEL, () => setPanelVisible(true))
    useMMGISEvent('tool:change', clearSelection)
    useMMGISEvent('map:drawstart', () => {
        setIsDrawing(true)
        setDrawVerticesCount(0)
    })
    useMMGISEvent('map:drawvertex', (e) => {
        const v = (e as { vertices?: unknown[] })?.vertices
        setDrawVerticesCount(Array.isArray(v) ? v.length : 0)
    })
    useMMGISEvent('map:drawcomplete', (e) => {
        setIsDrawing(false)
        setDrawShape(null)
        setDrawVerticesCount(0)
        const feature = (e as { feature?: Feature })?.feature
        if (!feature) return
        const shapeName = (feature.properties as Record<string, unknown> | null)?.shape
        const label = shapeName ? `Drawn ${shapeName}` : 'Drawn area'
        applySelection(feature, 'draw', label)
    })
    useMMGISEvent('map:drawcancel', () => {
        setIsDrawing(false)
        setDrawShape(null)
        setDrawVerticesCount(0)
    })
    useMMGISEvent('map:featureClick', (info) => {
        if (modeRef.current !== 'inspect') return
        const i = info as { layerId?: string; feature?: Feature }
        if (i?.layerId !== INSPECT_BOUNDARIES_LAYER_ID) return
        const feature = i?.feature
        const gtype = feature?.geometry?.type
        if (gtype !== 'Polygon' && gtype !== 'MultiPolygon') return
        const props = (feature!.properties || {}) as Record<string, unknown>
        const label =
            (props.name as string) ||
            (props.NAME as string) ||
            (props.title as string) ||
            (props._aoiKind ? `Inspected ${props._aoiKind}` : 'Inspected area')
        applySelection(feature as Feature, 'inspect', String(label))
    })
    useMMGISEvent('plugin:fetch-stats:analysisProgress', (p) => {
        const { done, total } = (p as { done: number; total: number }) || {}
        if (done === 0) {
            setAnalysisStatus('running')
            setAnalysisLabel(currentAOIRef.current?.label || 'Area of interest')
            setAnalysisDone(0)
            setAnalysisTotal(total)
        } else {
            setAnalysisDone(done)
        }
    })
    useMMGISEvent('plugin:fetch-stats:analysisReady', () => setAnalysisStatus('idle'))
    useMMGISEvent('plugin:fetch-stats:analysisSkipped', (p) => {
        const reason = (p as { reason?: string } | undefined)?.reason
        showAnalysisError(
            reason === 'no-eligible-layers'
                ? 'No analyzable layer is currently visible. Toggle on a layer with analysis support and try again.'
                : 'Analysis could not run.',
        )
    })

    // Cleanup transient artifacts on unmount.
    useEffect(() => {
        return () => {
            if (errorTimeoutRef.current) clearTimeout(errorTimeoutRef.current)
            disableDrawing()
            removeSelection()
            hideInspectBoundaries()
            hideTooltip()
        }
    }, [hideTooltip])

    // Hidden until the Title plugin requests it. Hooks above still run, so the
    // adapter keeps listening on the bus while the panel is not rendered.
    if (!panelVisible) return null

    return (
        <AOIPanel
            mode={mode}
            onModeChange={onModeChange}
            searchQuery={searchQuery}
            searchResults={searchResults}
            searchDisabled={searchDisabled}
            searchLoading={searchLoading}
            onSearchQueryChange={onSearchQueryChange}
            onSearchSelect={onSearchSelect}
            drawShape={drawShape}
            drawShapes={drawShapes}
            isDrawing={isDrawing}
            drawVerticesCount={drawVerticesCount}
            onDrawShapeChange={onDrawShapeChange}
            onDrawConfirm={onDrawConfirm}
            onDrawCancel={onDrawCancel}
            uploadStatus={uploadStatus}
            uploadError={uploadError}
            onUploadFile={onUploadFile}
            analysisStatus={analysisStatus}
            analysisLabel={analysisLabel}
            analysisDone={analysisDone}
            analysisTotal={analysisTotal}
            analysisError={analysisError}
            onDismissAnalysisError={dismissAnalysisError}
            onClose={onClose}
        />
    )
}
