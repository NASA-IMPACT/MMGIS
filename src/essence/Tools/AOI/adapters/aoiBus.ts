// AOI bus operations — every map:* / plugin:aoi:* call the tool makes.
// MMGIS-coupled; the lib/ components never import this.
import type { Feature } from 'geojson'
import { mmgisEmit, mmgisProvide, mmgisRequest } from '../../_shared/adapters/mmgisAPI'

export const PLUGIN_ID = 'aoi'
export const SELECTION_LAYER_ID = 'aoi:selection'
export const INSPECT_BOUNDARIES_LAYER_ID = 'aoi:inspect-boundaries'
export const TOOLTIP_OVERLAY_ID = 'aoi:tooltip'

// External trigger: the Title plugin owns the "Analyze area" button and emits
// this when it is clicked. AOI reveals its selection panel (search / inspect /
// draw / upload) in response — the panel stays hidden until then. Matches the
// `plugin:<id>:<event>` convention.
export const OPEN_PANEL_CHANNEL = 'plugin:title:analyzeAreaBtnClicked'

export const SELECTION_STYLE = {
    color: '#005ea2',
    weight: 3,
    fillColor: '#005ea2',
    fillOpacity: 0.25,
}
export const INSPECT_STYLE = {
    color: '#137480',
    weight: 1,
    fillColor: '#137480',
    fillOpacity: 0.06,
}

// Plugin-scoped emit/provide — manual `plugin:aoi:` prefix (shared mmgisAPI has
// no forPlugin helper; this matches the legacy forPlugin auto-prefix behavior).
export const emitAOI = (event: string, payload?: unknown) =>
    mmgisEmit(`plugin:${PLUGIN_ID}:${event}`, payload)
export const provideAOI = (name: string, handler: (...args: unknown[]) => unknown) =>
    mmgisProvide(`plugin:${PLUGIN_ID}:${name}`, handler)

const warn = (label: string) => (err: unknown) => console.warn(`[AOI] ${label} failed`, err)

// ── Drawing ─────────────────────────────────────────────────────────────────
export const enableDrawing = (shape: string) =>
    mmgisRequest('map:enableDrawing', { shape, options: { style: SELECTION_STYLE } }).catch(
        warn('enableDrawing'),
    )
export const finishDrawing = () =>
    mmgisRequest('map:finishDrawing').catch(warn('finishDrawing'))
export const disableDrawing = () =>
    mmgisRequest('map:disableDrawing').catch(warn('disableDrawing'))

// ── Selection layer ───────────────────────────────────────────────────────
export const drawSelection = (feature: Feature) =>
    mmgisRequest('map:createLayer', {
        id: SELECTION_LAYER_ID,
        type: 'vector',
        geojson: { type: 'FeatureCollection', features: [feature] },
        style: SELECTION_STYLE,
        interactive: false,
    }).catch(warn('add selection layer'))
export const removeSelection = () =>
    mmgisRequest('map:removeLayer', { id: SELECTION_LAYER_ID }).catch(() => {})

// ── Inspect boundaries layer ──────────────────────────────────────────────
export const showInspectBoundaries = (features: Feature[]) =>
    mmgisRequest('map:removeLayer', { id: INSPECT_BOUNDARIES_LAYER_ID })
        .catch(() => {})
        .then(() =>
            mmgisRequest('map:createLayer', {
                id: INSPECT_BOUNDARIES_LAYER_ID,
                type: 'vector',
                geojson: { type: 'FeatureCollection', features },
                style: INSPECT_STYLE,
                interactive: true,
            }),
        )
        .catch(warn('show inspect boundaries'))
export const hideInspectBoundaries = () =>
    mmgisRequest('map:removeLayer', { id: INSPECT_BOUNDARIES_LAYER_ID }).catch(() => {})

// ── Camera ────────────────────────────────────────────────────────────────
export const fitToBounds = (bbox: [number, number, number, number]) =>
    mmgisRequest('map:fitBounds', {
        bounds: [
            { lat: bbox[1], lng: bbox[0] },
            { lat: bbox[3], lng: bbox[2] },
        ],
        options: { padding: 120, maxZoom: 5 },
    })

// ── Tooltip overlay ───────────────────────────────────────────────────────
export const addTooltipOverlay = (
    latlng: { lat: number; lng: number },
    mount: (node: HTMLElement) => (() => void) | void,
) =>
    mmgisRequest('map:addOverlay', { id: TOOLTIP_OVERLAY_ID, latlng, mount }).catch(
        warn('addOverlay'),
    )
export const removeTooltipOverlay = () =>
    mmgisRequest('map:removeOverlay', { id: TOOLTIP_OVERLAY_ID }).catch(() => {})
