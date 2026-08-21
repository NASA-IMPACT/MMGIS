---
layout: page
title: Event Bus API
permalink: /apis/javascript/event-bus
parent: Main
grand_parent: JavaScript API
nav_order: 1
---

# Event Bus API

The MMGIS Event Bus provides a lightweight pub/sub and request/response system for plugin communication. It enables decoupled communication between tools, modules, and external integrations.

## Overview

The Event Bus is built on [mitt](https://github.com/developit/mitt) and exposes two communication patterns:

1. **Pub/Sub (Events)**: Fire-and-forget event broadcasting
2. **Request/Response (Providers)**: Synchronous or async data requests

All methods are available on `window.mmgisAPI`.

---

## Pub/Sub API

### `mmgisAPI.on(event, handler)`

Subscribe to an event.

**Parameters:**
- `event` (string): Event name using namespace:action format
- `handler` (function): Callback function receiving event data

**Returns:** Unsubscribe function

```javascript
// Subscribe to layer visibility changes
const unsubscribe = window.mmgisAPI.on('layer:visibilityChange', (data) => {
    console.log(`Layer ${data.layerName} is now ${data.on ? 'visible' : 'hidden'}`)
})

// Later, unsubscribe when done
unsubscribe()
```

### `mmgisAPI.off(event, handler)`

Unsubscribe from an event (alternative to using the returned unsubscribe function).

**Parameters:**
- `event` (string): Event name
- `handler` (function): The same handler function passed to `on()`

```javascript
function myHandler(data) {
    console.log(data)
}

window.mmgisAPI.on('tool:change', myHandler)

// Later
window.mmgisAPI.off('tool:change', myHandler)
```

### `mmgisAPI.emit(event, data)`

Emit an event to all subscribers.

**Parameters:**
- `event` (string): Event name
- `data` (any): Data to pass to subscribers

```javascript
// Emit a custom event from your plugin
window.mmgisAPI.emit('plugin:myPlugin:dataUpdated', {
    timestamp: Date.now(),
    values: [1, 2, 3]
})
```

---

## Request/Response API

### `mmgisAPI.provide(name, handler)`

Register a provider that responds to requests.

**Parameters:**
- `name` (string): Provider name using namespace:action format
- `handler` (function): Handler function that returns data (can be async). It is called as `handler(params, caller)`, where `caller` is the id of the plugin whose handle made the request, or `undefined` for a request that went out without one. Most providers answer the same either way and take `params` alone; one that answers per-caller (`map:hidePopup`) reads it. An existing function registered point-free — `provide('x', someFn)` — is handed it too

**Returns:** Cleanup function to remove the provider

```javascript
// Register a provider in your plugin
const cleanup = window.mmgisAPI.provide('plugin:myPlugin:getData', (params) => {
    return {
        value: params.id * 2,
        timestamp: Date.now()
    }
})

// Later, remove the provider
cleanup()
```

### `mmgisAPI.request(name, params, caller)`

Request data from a provider.

**Parameters:**
- `name` (string): Provider name
- `params` (any): Parameters to pass to the provider
- `caller` (string, optional): Id of the plugin asking, handed to the provider beside `params` rather than mixed into it, so a payload of any shape reaches the provider as it was written. Plugins do not pass this themselves — `forPlugin(id).request(...)` stamps it, which is the only reason it says anything (see Scoped `request` below)

**Returns:** Promise resolving to the provider's response

**Throws:** Error if no provider is registered for the name

```javascript
// Request data from a provider
try {
    const center = await window.mmgisAPI.request('map:getCenter')
    console.log(`Map center: ${center.lat}, ${center.lng}`)
} catch (err) {
    console.error('Provider not available:', err.message)
}
```

### `mmgisAPI.hasHandler(name)`

Check if a provider is registered.

**Parameters:**
- `name` (string): Provider name

**Returns:** boolean

```javascript
if (window.mmgisAPI.hasHandler('map:getCenter')) {
    const center = await window.mmgisAPI.request('map:getCenter')
}
```

---

## Plugin Scoped API

MMGIS automatically injects a scoped API into each tool as `this.api`. This API automatically prefixes event and provider names with `plugin:{pluginId}:`, where `pluginId` is derived from the tool's module name (e.g., `DrawTool` → `draw`).

> **Note:** Each plugin must have a unique ID. Multiple instances of the same plugin in a mission are not currently supported. If two plugins share the same ID, their events and providers will collide. This constraint is not currently enforced at runtime but may be in a future version.

The scoped API is available on `this.api` in your tool's `initialize()` and `make()` functions:

```javascript
const MyTool = {
    initialize() {
        // this.api is automatically available
        this.api.provide('getData', () => this.data)
    },

    make() {
        this.api.emit('ready', { timestamp: Date.now() })
    }
}
```

### Scoped `emit(event, data)`

Emit an event with auto-prefixed name.

```javascript
const api = window.mmgisAPI.forPlugin('myPlugin')

// This emits 'plugin:myPlugin:dataUpdated'
api.emit('dataUpdated', { value: 42 })

// Subscribers listen using the full path
window.mmgisAPI.on('plugin:myPlugin:dataUpdated', (data) => {
    console.log(data.value) // 42
})
```

### Scoped `provide(name, handler)`

Register a provider with auto-prefixed name.

**Returns:** Cleanup function

```javascript
const api = window.mmgisAPI.forPlugin('myPlugin')

// This registers 'plugin:myPlugin:getData'
const cleanup = api.provide('getData', (params) => {
    return { result: params.input * 2 }
})

// Callers request using the full path
const data = await window.mmgisAPI.request('plugin:myPlugin:getData', { input: 21 })
console.log(data.result) // 42

// Later, remove the provider
cleanup()
```

### Scoped `request(name, params)`

Make a request stamped with the plugin's id.

The name is **not** prefixed, unlike `emit` and `provide`: a request names someone else's provider, not one of this plugin's, and prefixing it would put `map:showPopup` out of reach. What the handle adds is the plugin's id, which travels beside the params and tells the provider who is asking.

```javascript
const api = window.mmgisAPI.forPlugin('myPlugin')

// Reaches 'map:hidePopup' under that exact name, with 'myPlugin'
// stamped on as the caller.
await api.request('map:hidePopup')
```

Prefer this to `window.mmgisAPI.request(...)`: some providers answer differently, or not at all, for a caller they cannot identify. A request made straight on `mmgisAPI` carries no id, so `map:hidePopup` retracts only a popup that was opened the same anonymous way.

### Metadata Properties

The scoped API also exposes metadata:

```javascript
const api = window.mmgisAPI.forPlugin('myPlugin')

console.log(api.pluginId) // 'myPlugin'
console.log(api.prefix)   // 'plugin:myPlugin:'
```

### Complete Plugin Example

```javascript
// MyPluginTool.js - this.api is automatically injected by ToolController
const MyPluginTool = {
    _cleanups: [],

    initialize() {
        // this.api is available here (auto-injected)
        // Register providers (auto-prefixed to 'plugin:myplugin:getData')
        this._cleanups.push(
            this.api.provide('getData', () => this.data),
            this.api.provide('setData', (newData) => { this.data = newData })
        )

        // Subscribe to events (use full paths via mmgisAPI)
        this._cleanups.push(
            window.mmgisAPI.on('layer:visibilityChange', this.handleLayerChange.bind(this))
        )
    },

    make() {
        // this.api also available here
        this.api.emit('ready', { timestamp: Date.now() })
    },

    destroy() {
        this._cleanups.forEach(fn => fn())
        this._cleanups = []
    },

    notifyUpdate() {
        // Emit events (auto-prefixed to 'plugin:myplugin:updated')
        this.api.emit('updated', { timestamp: Date.now() })
    }
}
```

---

## Available Events

### Layer Events

| Event | Payload | Description |
|-------|---------|-------------|
| `layer:visibilityChange` | `{ layerName, on }` | Fired when a layer is toggled on/off |
| `layer:refreshStatusChange` | `{ layerName, failed }` | Fired when a layer refresh succeeds or fails |
| `layer:headerStateChange` | `{ header_id, onState }` | Fired when a layer group header is expanded/collapsed |

```javascript
window.mmgisAPI.on('layer:visibilityChange', ({ layerName, on }) => {
    console.log(`${layerName} visibility: ${on}`)
})
```

### Tool Events

| Event | Payload | Description |
|-------|---------|-------------|
| `tool:change` | `{ toolName }` | Fired when the active tool changes |

```javascript
window.mmgisAPI.on('tool:change', ({ toolName }) => {
    console.log(`Active tool: ${toolName}`)
})
```

### Feature Events

| Event | Payload | Description |
|-------|---------|-------------|
| `feature:active` | `{ layerName, feature, layer }` | Fired when a feature becomes active/selected |

```javascript
window.mmgisAPI.on('feature:active', ({ layerName, feature }) => {
    console.log(`Selected feature in ${layerName}:`, feature.properties)
})
```

### Time Events

| Event | Payload | Description |
|-------|---------|-------------|
| `time:changed` | `{ startTime, currentTime, endTime }` | Fired after a time change is committed, carrying the new committed state. Pairs with `time:changeRequested` |
| `time:changeRequested` | `{ startTime, currentTime, endTime }` | Emitted by a plugin to ask core to commit a new time window. ISO 8601 strings. Ignored while time is disabled for the mission |
| `time:toggleUI` | `{ active }` | Fired when time UI is shown/hidden |

```javascript
window.mmgisAPI.on('time:changed', ({ startTime, currentTime, endTime }) => {
    console.log(`Time range: ${startTime} - ${endTime}`)
})

// Ask core to move the current time. Core commits it and broadcasts the
// result on 'time:changed' — including back to the plugin that asked.
window.mmgisAPI.emit('time:changeRequested', {
    startTime: '2024-01-01T00:00:00.000Z',
    endTime: '2024-12-31T23:59:59.000Z',
    currentTime: '2024-06-15T12:00:00.000Z'
})
```

### Legend Events

| Event | Payload | Description |
|-------|---------|-------------|
| `legend:made` | `{ layerName, id, legendData }` | Fired when a legend is created |

```javascript
window.mmgisAPI.on('legend:made', ({ layerName, legendData }) => {
    console.log(`Legend created for ${layerName}`)
})
```

### WebSocket Events

| Event | Payload | Description |
|-------|---------|-------------|
| `websocket:change` | `{ data }` | Fired on WebSocket messages |

---

## Available Providers

### Map Providers

| Provider | Params | Returns | Description |
|----------|--------|---------|-------------|
| `map:getCenter` | none | `{ lat, lng }` | Get map center coordinates |
| `map:getBounds` | none | `LatLngBounds` | Get map bounds |
| `map:getZoom` | none | `number` | Get current zoom level |
| `map:setView` | `{ center, zoom }` | `true` | Set map view |
| `map:fitBounds` | `bounds` | `true` | Fit map to bounds |
| `map:panTo` | `{ lat, lng }` | `true` | Pan map to coordinates |
| `map:showPopup` | `MapPopupRequest` | `MapPopupResult` | Show a map-anchored popup at a lat/lng, replacing any current popup. Answers only once the popup closes |
| `map:hidePopup` | none | `boolean` | Retract the caller's own popup, resolving its request with `{ action: 'closed' }`. `false` when the popup showing is someone else's, or there is none |

```javascript
// Get current map state
const center = await window.mmgisAPI.request('map:getCenter')
const zoom = await window.mmgisAPI.request('map:getZoom')
const bounds = await window.mmgisAPI.request('map:getBounds')

// Modify map view
await window.mmgisAPI.request('map:setView', {
    center: { lat: 45, lng: -120 },
    zoom: 10
})

await window.mmgisAPI.request('map:fitBounds', [
    [44, -121],
    [46, -119]
])

await window.mmgisAPI.request('map:panTo', { lat: 45, lng: -120 })
```

#### `map:showPopup`

A map-anchored popup rendered and styled by the core. The request holds only serializable data, so it survives a sandbox boundary — the plugin sends the content; the core owns the DOM, the theme, and the lifecycle. There is a single popup slot and no popup id: a request from any caller replaces the current popup, whose own request then resolves `'closed'`. Nothing about a popup is broadcast on the bus — the outcome travels back on the request's promise, which stays pending for as long as the popup is open and resolves with how it closed.

```javascript
const api = window.mmgisAPI.forPlugin('crater-info')

// Pending until the popup closes — hold onto it rather than blocking on it.
const outcome = api.request('map:showPopup', {
    latlng: { lat: 45, lng: -120 }, // anchor, tracked as the map moves
    html: '<strong>Crater A</strong><p>Diameter: 12 km</p>', // sanitized by the core
    primaryAction: { label: 'Analyze' },
    secondaryAction: { label: 'Cancel' }
})

outcome.then(({ action }) => {
    if (action === 'primary') analyze()
    else if (action === 'secondary' || action === 'dismiss') clearSelection()
    // 'closed': replaced or retracted — nothing for this plugin to undo.
}, showError)

// On teardown, retract freely: this closes only this plugin's own popup
// (the request above then resolves 'closed') and rejects harmlessly when a
// mission switch has already taken the provider down.
function destroy() {
    api.request('map:hidePopup').catch(() => {})
}
```

The result is `{ action }`:

| `action` | Meaning |
|----------|---------|
| `'primary'` | The primary button was pressed |
| `'secondary'` | The secondary button was pressed |
| `'dismiss'` | The user dismissed the popup with the X or a click elsewhere on the map |
| `'closed'` | The popup went away without the user acting on it: another `map:showPopup` replaced it, `map:hidePopup` retracted it, or the mission switched |

Ownership decides who may *retract* a popup, never who may open one. A request made through a plugin's handle carries the plugin's id (see Scoped `request` above), and `map:hidePopup` retracts only the popup its own caller opened — answering `false` when the slot holds someone else's popup, or nothing — so it is safe to call blind on teardown. Prefer the handle to a bare `mmgisAPI.request(...)`: an id-less request opens a popup that any other id-less caller can retract.

The request rejects — showing nothing — when it is invalid (`html` must be a string and `latlng` finite numbers) or when the popup could not be mounted. An action renders only when its `label` is a non-empty string; two actions render as equal-width buttons with the primary first, and a lone action takes the primary styling whichever field it arrived in, still answering with its own slot. The popup tracks its anchor as the map pans and hides for the length of the 2D engine's zoom animation, returning once the zoom settles.

A click elsewhere on the map dismisses the popup at the end of that click's own task: a replacement popup shown in the same task wins, resolving the earlier request with `'closed'`, while one shown after an `await` arrives after the dismissal, so the earlier request resolves `'dismiss'`. Either way the plugin is told, exactly once.

### Layer Providers

| Provider | Params | Returns | Description |
|----------|--------|---------|-------------|
| `layers:getAll` | none | `string[]` | Get all layer names |
| `layers:getVisible` | none | `object` | Get visibility state of all layers |
| `layers:getConfig` | `layerUUID` | `object \| null` | Get layer configuration |
| `layers:toggle` | `layerUUID` | `boolean \| null` | Toggle layer visibility |

```javascript
// Get layer information
const allLayers = await window.mmgisAPI.request('layers:getAll')
const visibleLayers = await window.mmgisAPI.request('layers:getVisible')
const config = await window.mmgisAPI.request('layers:getConfig', 'myLayerName')

// Toggle a layer
const newState = await window.mmgisAPI.request('layers:toggle', 'myLayerName')
```

### Time Providers

| Provider | Params | Returns | Description |
|----------|--------|---------|-------------|
| `time:isEnabled` | none | `boolean` | Whether the mission has time enabled. The getters below return `null` both when time is off and when it is on but not yet seeded |
| `time:getCurrent` | none | `string` | Get current time |
| `time:getStart` | none | `string` | Get start time |
| `time:getEnd` | none | `string` | Get end time |
| `time:set` | `{ startTime, endTime, currentTime, ... }` | `boolean` | Set time range |

```javascript
// Get time state
const timeEnabled = await window.mmgisAPI.request('time:isEnabled')
const current = await window.mmgisAPI.request('time:getCurrent')
const start = await window.mmgisAPI.request('time:getStart')
const end = await window.mmgisAPI.request('time:getEnd')

// Set time range
await window.mmgisAPI.request('time:set', {
    startTime: '2024-01-01T00:00:00Z',
    endTime: '2024-12-31T23:59:59Z',
    currentTime: '2024-06-15T12:00:00Z'
})
```

### Globe Providers

| Provider | Params | Returns | Description |
|----------|--------|---------|-------------|
| `globe:getMouse` | none | `{ lng, lat } \| null` | Get mouse position on globe |
| `globe:getZoom` | none | `number \| null` | Get globe zoom level |

```javascript
const mousePos = await window.mmgisAPI.request('globe:getMouse')
if (mousePos) {
    console.log(`Mouse at: ${mousePos.lat}, ${mousePos.lng}`)
}
```

### App Providers

| Provider | Params | Returns | Description |
|----------|--------|---------|-------------|
| `app:getMissionPath` | none | `string` | Get current mission path |

```javascript
const missionPath = await window.mmgisAPI.request('app:getMissionPath')
console.log(`Current mission: ${missionPath}`)
```

### Plugin Providers

| Provider | Params | Returns | Description |
|----------|--------|---------|-------------|
| `plugin:info:showFeature` | `{ layerName, layer }` | `boolean` | Show feature in InfoTool |
| `plugin:info:getCurrentFeature` | none | `{ layerName, feature } \| null` | Get currently displayed feature |
| `plugin:draw:getActiveFeature` | none | `feature \| null` | Get active draw feature |
| `plugin:draw:getFilesOn` | none | `string[]` | Get enabled draw files |
| `plugin:layers:populateCogScale` | `layerName` | `true` | Update COG scale UI |

---

## Event Naming Conventions

Events and providers follow a namespace:action pattern:

- **Core namespaces**: `map:`, `layers:`, `time:`, `globe:`, `app:`
- **Plugin namespaces**: `plugin:pluginName:`
- **Custom namespaces**: `custom:yourNamespace:`

Examples:
- `map:getCenter` - Core map provider
- `layer:visibilityChange` - Core layer event
- `plugin:draw:getActiveFeature` - DrawTool plugin provider
- `custom:analytics:trackEvent` - Custom event for external integration

---

## Best Practices

### 1. Always Unsubscribe

Store unsubscribe functions and call them during cleanup:

```javascript
const MyPlugin = {
    _unsubscribers: [],

    init() {
        this._unsubscribers.push(
            window.mmgisAPI.on('layer:visibilityChange', this.handleLayerChange),
            window.mmgisAPI.on('time:changed', this.handleTimeChange)
        )
    },

    destroy() {
        this._unsubscribers.forEach(unsub => unsub())
        this._unsubscribers = []
    }
}
```

### 2. Check Provider Availability

Use `hasHandler` before making requests to optional providers:

```javascript
if (window.mmgisAPI.hasHandler('plugin:optional:getData')) {
    const data = await window.mmgisAPI.request('plugin:optional:getData')
}
```

### 3. Handle Provider Re-initialization

When registering providers, clean up previous registrations:

```javascript
let _providerCleanups = []

function initProviders() {
    if (window.mmgisAPI) {
        // Clean up previous providers
        _providerCleanups.forEach(cleanup => cleanup())
        _providerCleanups = [
            window.mmgisAPI.provide('plugin:myPlugin:getData', handler1),
            window.mmgisAPI.provide('plugin:myPlugin:setData', handler2),
        ]
    }
}
```

### 4. Use `this.api` for Auto-Namespacing

Tools have a scoped API automatically injected as `this.api`. Use it for emitting events and providing handlers:

```javascript
// In your tool - this.api is auto-injected by ToolController
this.api.emit('updated', data)           // -> 'plugin:mytool:updated'
this.api.provide('getData', () => myData) // -> 'plugin:mytool:getData'

// For subscribing/requesting, use mmgisAPI directly with full paths
window.mmgisAPI.on('layer:visibilityChange', handler)
window.mmgisAPI.request('plugin:draw:getData')
```

See [Plugin Scoped API](#plugin-scoped-api) for full details.

### 5. Graceful Degradation

Check if `mmgisAPI` exists before using it:

```javascript
if (window.mmgisAPI) {
    window.mmgisAPI.on('layer:visibilityChange', handler)
}
```

---

## Migration from Legacy Patterns

### From `L_.subscribe*` / `L_.unsubscribe*`

```javascript
// Old pattern
L_.subscribeOnLayerToggle('MyPlugin', handler)
L_.unsubscribeOnLayerToggle('MyPlugin')

// New pattern
const unsub = window.mmgisAPI.on('layer:visibilityChange', handler)
unsub() // to unsubscribe
```

### From `document.addEventListener` with CustomEvents

```javascript
// Old pattern
document.addEventListener('toolChange', handler)
document.removeEventListener('toolChange', handler)

// New pattern
const unsub = window.mmgisAPI.on('tool:change', handler)
unsub() // to unsubscribe
```

### From Direct `Map_.map.*` Calls

```javascript
// Old pattern
Map_.map.fitBounds(bounds)
Map_.map.panTo(coords)
const zoom = Map_.map.getZoom()

// New pattern
await window.mmgisAPI.request('map:fitBounds', bounds)
await window.mmgisAPI.request('map:panTo', coords)
const zoom = await window.mmgisAPI.request('map:getZoom')
```

---

## Backward Compatibility

The legacy patterns (`L_.subscribe*`, `document.addEventListener`, `Map_.map.*`) continue to work alongside the new Event Bus API. Both systems emit events in parallel during the transition period.
