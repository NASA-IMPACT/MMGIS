/**
 * MapComparison — side-by-side swipe comparison controller.
 *
 * Owns the draggable divider DOM element and delegates all rendering to the
 * active map engine via the optional `enableComparison` / `disableComparison` /
 * `setComparisonDivider` methods on IMapEngine.
 *
 * External consumers drive this entirely through the mmgisAPI event bus:
 *   mmgisAPI.request('map:comparison:enable', { leftLayers, rightLayers })
 *   mmgisAPI.request('map:comparison:disable')
 *   mmgisAPI.request('map:comparison:setDividerPosition', 0.5)
 *   mmgisAPI.on('map:comparison:dividerMoved', handler)
 *
 * Providers and events are registered in Map_.js once the engine is ready.
 */

import './MapComparison.css'

let _engine = null

const _state = {
    enabled: false,
    dividerPosition: 0.5,
    left: { layerIds: [], date: null },
    right: { layerIds: [], date: null },
}

let _dividerEl = null
let _mouseDragMove = null
let _mouseDragEnd = null

// ── Public API ────────────────────────────────────────────────────────────────

function init(engine) {
    _engine = engine
}

/**
 * Enable comparison mode.
 *
 * Per-side date pinning (compare-dates) is not implemented yet — leftDate/rightDate
 * are accepted for forward API compatibility but both sides currently follow
 * the global timeline like any other layer.
 *
 * @param {object} config
 * @param {string[]} config.leftLayers  - Layer IDs (MMGIS layer names) for the left side.
 * @param {string[]} config.rightLayers - Layer IDs (MMGIS layer names) for the right side.
 * @param {string|null} [config.leftDate]  - Reserved for future per-side date pinning.
 * @param {string|null} [config.rightDate] - Reserved for future per-side date pinning.
 */
function enable({ leftLayers = [], rightLayers = [], leftDate = null, rightDate = null } = {}) {
    if (!_engine?.enableComparison) {
        console.warn('[MapComparison] Active engine does not support comparison mode.')
        return
    }

    _state.left = { layerIds: leftLayers, date: leftDate }
    _state.right = { layerIds: rightLayers, date: rightDate }
    if (!_state.enabled) _state.dividerPosition = 0.5

    _engine.enableComparison({
        leftLayerIds: leftLayers,
        rightLayerIds: rightLayers,
    })

    if (!_state.enabled) _createDivider()

    _state.enabled = true

    window.mmgisAPI?.emit('map:comparison:enabled', {
        leftLayers,
        rightLayers,
        leftDate,
        rightDate,
    })
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
 */
function setDividerPosition(pos) {
    const clamped = Math.max(0, Math.min(1, pos))
    _state.dividerPosition = clamped
    _engine?.setComparisonDivider?.(clamped)
    if (_dividerEl) _dividerEl.style.left = (clamped * 100) + '%'
}

/** Returns a snapshot of the current comparison state. */
function getState() {
    return {
        enabled: _state.enabled,
        dividerPosition: _state.dividerPosition,
        left: { ..._state.left },
        right: { ..._state.right },
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
    container.appendChild(_dividerEl)

    _dividerEl.addEventListener('mousedown', _onMouseDown)
    _dividerEl.addEventListener('touchstart', _onTouchStart, { passive: false })
}

function _destroyDivider() {
    if (_dividerEl) {
        _dividerEl.removeEventListener('mousedown', _onMouseDown)
        _dividerEl.removeEventListener('touchstart', _onTouchStart)
        _clearMouseDrag()
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

    const onMove = (ev) => {
        if (ev.touches.length > 0) _handleDrag(ev.touches[0].clientX)
    }
    const onEnd = () => {
        document.removeEventListener('touchmove', onMove)
        document.removeEventListener('touchend', onEnd)
    }

    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', onEnd)
}

function _handleDrag(clientX) {
    if (!_engine) return
    const container = _engine.getContainer()
    if (!container) return

    const rect = container.getBoundingClientRect()
    const pos = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))

    _state.dividerPosition = pos
    _engine.setComparisonDivider?.(pos)
    if (_dividerEl) _dividerEl.style.left = (pos * 100) + '%'

    window.mmgisAPI?.emit('map:comparison:dividerMoved', { position: pos, x: clientX })
}

// ── Export ────────────────────────────────────────────────────────────────────

const MapComparison = {
    init,
    enable,
    disable,
    setLeftSide,
    setRightSide,
    setDividerPosition,
    getState,
    isEnabled,
}

export default MapComparison
