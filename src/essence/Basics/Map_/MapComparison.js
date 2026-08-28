/**
 * MapComparison — two-sided layer comparison controller.
 *
 * Owns the draggable divider DOM element and delegates all rendering to the
 * active map engine via the optional `enableComparison` / `disableComparison` /
 * `setComparisonDivider` / `setComparisonLayout` methods on IMapEngine.
 *
 * Two layouts share the divider:
 *   - 'swipe'      — one view, wiped between the two layers.
 *   - 'sideBySide' — two panes meeting at the divider, same centre and zoom,
 *                    one layer each, so both are read at once.
 *
 * External consumers drive this entirely through the mmgisAPI event bus:
 *   mmgisAPI.request('map:comparison:enable', { leftLayers, rightLayers, layout })
 *   mmgisAPI.request('map:comparison:disable')
 *   mmgisAPI.request('map:comparison:setLayout', { layout: 'sideBySide' })
 *   mmgisAPI.request('map:comparison:setDividerPosition', 0.5)
 *   mmgisAPI.on('map:comparison:dividerMoved', handler)
 *
 * The `map:comparison:*` providers above are registered by `init`, which Map_
 * calls once the engine is ready and again on every engine change.
 */

import './MapComparison.css'
import { buildTimePinnedProps, pinWindowFor } from './comparisonTimePins'

let _engine = null

/** Layouts the divider can split the map into. */
const LAYOUTS = ['swipe', 'sideBySide']
const DEFAULT_LAYOUT = 'swipe'

const _state = {
    enabled: false,
    layout: DEFAULT_LAYOUT,
    dividerPosition: 0.5,
    left: { layerIds: [], date: null },
    right: { layerIds: [], date: null },
}

let _dividerEl = null
let _mouseDragMove = null
let _mouseDragEnd = null
let _touchDragMove = null
let _touchDragEnd = null
let _providerCleanups = []

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Bind the controller to the active map engine and register the
 * `map:comparison:*` providers on the event bus.
 *
 * Map_ calls this again whenever it re-initialises onto another engine, so any
 * comparison left running on the previous one is torn down first and the
 * previous registration is dropped, which also keeps the bus from warning about
 * replaced handlers.
 */
function init(engine) {
    _resetForEngineChange()
    _engine = engine

    _providerCleanups.forEach((cleanup) => cleanup())
    _providerCleanups = []

    // The bus is optional and, in tests, often a partial stub, so the
    // registration is skipped rather than assumed.
    if (typeof window.mmgisAPI?.provide !== 'function') return

    const provide = (name, handler) =>
        _providerCleanups.push(window.mmgisAPI.provide(name, handler))

    provide('map:comparison:enable', (p) => enable(p))
    provide('map:comparison:disable', () => disable())
    provide('map:comparison:setLeftSide', (p) => setLeftSide(p))
    provide('map:comparison:setRightSide', (p) => setRightSide(p))
    provide('map:comparison:setLayout', (p) => setLayout(p))
    provide('map:comparison:setDividerPosition', (p) => setDividerPosition(p))
    provide('map:comparison:getState', () => getState())
}

/**
 * Drop comparison state belonging to a map engine that is going away.
 *
 * The divider is attached to the outgoing engine's container and the incoming
 * engine starts with no comparison of its own, so the controller returns to its
 * disabled state and says so on the bus, letting consumers drop a stale "on"
 * indicator. The outgoing engine is not asked to undo anything, since it is
 * being discarded, and no comparison is re-established here: layers are built
 * after the controller is bound, so there is nothing yet to compare.
 */
function _resetForEngineChange() {
    if (!_state.enabled) return

    _destroyDivider()

    _state.enabled = false
    _state.left = { layerIds: [], date: null }
    _state.right = { layerIds: [], date: null }

    window.mmgisAPI?.emit('map:comparison:disabled', {})
}

/**
 * Enable comparison mode.
 *
 * A side given a date draws its layers at that date instead of the global one;
 * a side given none follows the global timeline, which is what the primary side
 * wants — core has already reloaded those layers for the global instant.
 *
 * @param {object} config
 * @param {string[]} config.leftLayers  - Layer IDs (MMGIS layer names) for the left side.
 * @param {string[]} config.rightLayers - Layer IDs (MMGIS layer names) for the right side.
 * @param {string|null} [config.leftDate]  - ISO instant the left side is pinned to.
 * @param {string|null} [config.rightDate] - ISO instant the right side is pinned to.
 * @param {'swipe'|'sideBySide'} [config.layout] - Defaults to the layout already in effect.
 */
function enable({
    leftLayers = [],
    rightLayers = [],
    leftDate = null,
    rightDate = null,
    layout,
} = {}) {
    if (!_engine?.enableComparison) {
        console.warn('[MapComparison] Active engine does not support comparison mode.')
        return
    }

    _state.left = { layerIds: leftLayers, date: leftDate }
    _state.right = { layerIds: rightLayers, date: rightDate }
    _state.layout = _resolveLayout(layout) ?? _state.layout
    if (!_state.enabled) _state.dividerPosition = 0.5

    // The engine draws its split from whatever position it was last told, so
    // it is told this one before it draws anything.
    _applyDividerPosition(_state.dividerPosition)

    _engine.enableComparison({
        leftLayerIds: leftLayers,
        rightLayerIds: rightLayers,
        ..._sideProps('leftLayerProps', leftLayers, leftDate),
        ..._sideProps('rightLayerProps', rightLayers, rightDate),
        layout: _state.layout,
    })

    if (!_state.enabled) _createDivider()
    _applyDividerLayout()

    _state.enabled = true

    window.mmgisAPI?.emit('map:comparison:enabled', {
        leftLayers,
        rightLayers,
        leftDate,
        rightDate,
        layout: _state.layout,
    })
}

/**
 * One side's entry in the engine config: the prop overrides that redraw its
 * layers at `date`, or nothing at all when the side is unpinned.
 */
function _sideProps(key, layerIds, date) {
    if (date == null) return {}
    return { [key]: buildTimePinnedProps(layerIds, pinWindowFor(date)) }
}

/**
 * Switch how the divider splits the map, keeping both sides' layers and the
 * divider's position as they are.
 */
function setLayout(layout) {
    const next = _resolveLayout(layout)
    if (next === null || next === _state.layout) return

    // Checked before the state is written, so a refused switch leaves
    // `getState()` reporting the layout actually on screen.
    if (_state.enabled && !_engine?.setComparisonLayout) {
        console.warn(
            '[MapComparison] Active engine does not support comparison layouts.',
        )
        return
    }

    _state.layout = next

    if (_state.enabled) {
        // Changing layout rebuilds the engine's rendering surfaces around the
        // divider, so it is handed the position the divider keeps.
        _applyDividerPosition(_state.dividerPosition)
        _engine.setComparisonLayout(next)
        _applyDividerLayout()
    }

    window.mmgisAPI?.emit('map:comparison:layoutChanged', { layout: next })
}

/** Read a layout off a payload, accepting either a bare string or `{ layout }`. */
function _resolveLayout(value) {
    const name = typeof value === 'string' ? value : value?.layout
    if (name == null) return null
    if (!LAYOUTS.includes(name)) {
        console.warn(`[MapComparison] Unknown comparison layout "${name}".`)
        return null
    }
    return name
}

/**
 * Mark the divider with the active layout. Side-by-side is a seam between two
 * panes rather than a wipe across one, and it reads as a different control.
 */
function _applyDividerLayout() {
    if (!_dividerEl) return
    _dividerEl.classList.toggle(
        'mmgis-comparison-divider--side-by-side',
        _state.layout === 'sideBySide',
    )
}

/** Disable comparison mode and restore the normal single-viewport view. */
function disable() {
    if (!_state.enabled) return

    _engine?.disableComparison?.()
    _destroyDivider()

    _state.enabled = false
    _state.left = { layerIds: [], date: null }
    _state.right = { layerIds: [], date: null }

    window.mmgisAPI?.emit('map:comparison:disabled', {})
}

/** Replace the left side's layer set (and optional date pin). */
function setLeftSide({ layers = [], date = null } = {}) {
    _state.left = { layerIds: layers, date }
    if (_state.enabled) {
        enable({
            leftLayers: layers,
            rightLayers: _state.right.layerIds,
            leftDate: date,
            rightDate: _state.right.date,
        })
    }
    window.mmgisAPI?.emit('map:comparison:sidesUpdated', { side: 'left', layers, date })
}

/** Replace the right side's layer set (and optional date pin). */
function setRightSide({ layers = [], date = null } = {}) {
    _state.right = { layerIds: layers, date }
    if (_state.enabled) {
        enable({
            leftLayers: _state.left.layerIds,
            rightLayers: layers,
            leftDate: _state.left.date,
            rightDate: date,
        })
    }
    window.mmgisAPI?.emit('map:comparison:sidesUpdated', { side: 'right', layers, date })
}

/**
 * Move the divider to `pos` (0–1 fraction of container width).
 * Updates both the DOM element and the engine's clip regions.
 *
 * Accepts a bare number or `{ position }`, matching `setLayout`.
 */
function setDividerPosition(pos) {
    const value = typeof pos === 'number' ? pos : pos?.position
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        console.warn(
            `[MapComparison] Divider position must be a number between 0 and 1, got ${JSON.stringify(pos)}.`,
        )
        return
    }
    _applyDividerPosition(Math.max(0, Math.min(1, value)))
}

/**
 * Write `pos` (0–1 fraction of container width) everywhere the divider is
 * read: the state that owns it, the engine that clips or splits by it, and the
 * element the user drags. The engine holds no position of its own that could
 * drift from the line on screen — it is told this one every time it changes.
 */
function _applyDividerPosition(pos) {
    _state.dividerPosition = pos
    _engine?.setComparisonDivider?.(pos)
    if (_dividerEl) _dividerEl.style.left = (pos * 100) + '%'
}

/**
 * Returns a snapshot of the current comparison state. The layer lists are
 * copied, so a caller cannot write through the snapshot into live state.
 */
function getState() {
    const side = ({ layerIds, date }) => ({ layerIds: [...layerIds], date })
    return {
        enabled: _state.enabled,
        layout: _state.layout,
        dividerPosition: _state.dividerPosition,
        left: side(_state.left),
        right: side(_state.right),
    }
}

/** Returns true when comparison mode is active. */
function isEnabled() {
    return _state.enabled
}

// ── Divider DOM ───────────────────────────────────────────────────────────────

function _createDivider() {
    if (!_engine) return
    const container = _engine.getContainer()
    if (!container) return

    _dividerEl = document.createElement('div')
    _dividerEl.className = 'mmgis-comparison-divider'
    _dividerEl.style.left = (_state.dividerPosition * 100) + '%'
    _applyDividerLayout()
    container.appendChild(_dividerEl)

    _dividerEl.addEventListener('mousedown', _onMouseDown)
    _dividerEl.addEventListener('touchstart', _onTouchStart, { passive: false })
}

function _destroyDivider() {
    if (_dividerEl) {
        _dividerEl.removeEventListener('mousedown', _onMouseDown)
        _dividerEl.removeEventListener('touchstart', _onTouchStart)
        _clearMouseDrag()
        _clearTouchDrag()
        _dividerEl.parentNode?.removeChild(_dividerEl)
        _dividerEl = null
    }
}

function _onMouseDown(e) {
    e.preventDefault()
    e.stopPropagation()

    _mouseDragMove = (ev) => _handleDrag(ev.clientX)
    _mouseDragEnd = () => _clearMouseDrag()

    document.addEventListener('mousemove', _mouseDragMove)
    document.addEventListener('mouseup', _mouseDragEnd)
}

function _clearMouseDrag() {
    if (_mouseDragMove) {
        document.removeEventListener('mousemove', _mouseDragMove)
        document.removeEventListener('mouseup', _mouseDragEnd)
        _mouseDragMove = null
        _mouseDragEnd = null
    }
}

function _onTouchStart(e) {
    e.preventDefault()
    e.stopPropagation()

    _touchDragMove = (ev) => {
        if (ev.touches.length > 0) _handleDrag(ev.touches[0].clientX)
    }
    _touchDragEnd = () => _clearTouchDrag()

    document.addEventListener('touchmove', _touchDragMove, { passive: false })
    document.addEventListener('touchend', _touchDragEnd)
    // A gesture the system takes over ends in `touchcancel`, not `touchend`.
    document.addEventListener('touchcancel', _touchDragEnd)
}

function _clearTouchDrag() {
    if (_touchDragMove) {
        document.removeEventListener('touchmove', _touchDragMove)
        document.removeEventListener('touchend', _touchDragEnd)
        document.removeEventListener('touchcancel', _touchDragEnd)
        _touchDragMove = null
        _touchDragEnd = null
    }
}

function _handleDrag(clientX) {
    if (!_engine) return
    const container = _engine.getContainer()
    if (!container) return

    const rect = container.getBoundingClientRect()
    const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))

    _applyDividerPosition(pos)

    window.mmgisAPI?.emit('map:comparison:dividerMoved', { position: pos, x: clientX })
}

// ── Export ────────────────────────────────────────────────────────────────────

const MapComparison = {
    init,
    enable,
    disable,
    setLeftSide,
    setRightSide,
    setLayout,
    setDividerPosition,
    getState,
    isEnabled,
}

export default MapComparison
