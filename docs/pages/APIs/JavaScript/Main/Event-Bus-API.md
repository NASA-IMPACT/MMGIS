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
- `handler` (function): Handler function that returns data (can be async)

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

### `mmgisAPI.request(name, params)`

Request data from a provider.

**Parameters:**
- `name` (string): Provider name
- `params` (any): Parameters to pass to the provider

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

### Panel and Plugin Events

| Event | Payload | Description |
|-------|---------|-------------|
| `panels:changed` | `{ panels }` | Fired whenever the panel layout changes — a panel registered or unregistered, changed state, lost a tool, or was resized |
| `plugins:changed` | `{ plugins }` | Fired whenever a plugin is shown, hidden, loaded or unloaded by command, and once after a batch of plugins loads with the layout |

`panels` carries the same listing [`panels:getAll`](#panel-and-plugin-providers)
returns, and `plugins` the same listing `plugins:getAll` returns, so there is
nothing to re-request. Setting something to the state it already holds is a
quiet no-op — no event fires.

Neither event fires while the layout is being torn down: teardown destroys
the subscribers along with the state they were following, so there is nobody
left to tell.

```javascript
window.mmgisAPI.on('panels:changed', ({ panels }) => {
    const mine = panels.find((p) => p.id === 'left-panel')
    console.log(`left-panel is now ${mine.state}`)
})
```

A component that seeds from `panels:getAll` and also subscribes to
`panels:changed` must guard the seed so it cannot overwrite state an event
has already delivered — the request can resolve after a later event lands.

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

### Panel and Plugin Providers

| Provider | Params | Returns | Description |
|----------|--------|---------|-------------|
| `panels:getAll` | none | `PanelInfo[]` | Every panel in the layout, ordered by priority |
| `panels:setState` | `{ panelId, state }` | `CommandResult` | Move a panel to `collapsed`, `expanded`, `iconified` or `focused` |
| `panels:show` | `{ panelId }` | `CommandResult` | Restore a collapsed panel to its last visible state |
| `panels:hide` | `{ panelId }` | `CommandResult` | Collapse a panel without destroying its contents |
| `plugins:getAll` | none | `PluginInfo[]` | Every plugin the layout knows, with its lifecycle state |
| `plugins:setState` | `{ pluginId, state }` | `CommandResult` | Move a plugin to `unloaded`, `hidden` or `visible` |
| `plugins:show` | `{ pluginId }` | `CommandResult` | Reveal a plugin, loading it first if it is unloaded |
| `plugins:hide` | `{ pluginId }` | `CommandResult` | Hide a plugin, preserving its instance and state |

Each `PanelInfo` carries what it takes to target one: `id`, `position`, current
`state`, and the `toolIds` it holds — which is how a plugin recognizes the panel
it lives in.
Each `PluginInfo` carries `id` and `state`.

`show` and `hide` are thin sugar over `setState` — they resolve a target state
rather than flipping whatever they find. `panels:show` restores the panel's
`lastVisibleState`; `plugins:show` resolves to `visible`, loading the plugin
first if it is unloaded. `panels:hide` and `plugins:hide` always target
`collapsed`/`hidden`. A panel that is not collapsed is already shown, so
`panels:show` leaves it exactly as it is and reports `changed: false` —
it never moves a panel the user expanded down to a smaller state.

Every command returns a `CommandResult` rather than a bare boolean:

```ts
{ ok: true,  state: 'collapsed', changed: true }
{ ok: false, reason: 'not-found' | 'state-not-allowed' | 'no-visible-state'
                   | 'layout-inactive' | 'bad-request' | 'load-failed'
                   | 'transition-failed' }
```

`not-found` is an unknown id. `state-not-allowed` is a transition the panel's
own configuration forbids — a float panel refusing `iconified`, for example.
`no-visible-state` is a `panels:show` with no allowed state left to restore to.
`bad-request` is a malformed payload. `load-failed` is any `plugins:*` command
that must load an unloaded plugin first and fails to. `transition-failed` is
core failing to carry out a transition it accepted — distinct from
`not-found`, which means the id named nothing. `layout-inactive` covers
two cases a caller cannot distinguish — a core too old to have registered the
handler, or a core that has it but currently has no layout mounted — and
deliberately collapses them, since both mean the same thing to a caller: there
is nothing to command.

Commands name the state they want rather than flipping whatever they find, so a
control drawn from a listing read moments earlier still lands on the state the
click asked for, and a failed request is safe to retry. Asking for the state
something already holds succeeds with `changed: false` and broadcasts nothing.

```javascript
const panels = await window.mmgisAPI.request('panels:getAll')
const mine = panels.find((p) => p.toolIds.includes('myPlugin'))

const result = await window.mmgisAPI.request(
    mine.state === 'collapsed' ? 'panels:show' : 'panels:hide',
    { panelId: mine.id }
)
if (!result.ok) console.warn(`Refused: ${result.reason}`)
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

- **Core namespaces**: `map:`, `layers:`, `time:`, `globe:`, `panels:`, `plugins:`, `app:`
- **Plugin namespaces**: `plugin:pluginName:`
- **Custom namespaces**: `custom:yourNamespace:`

Examples:
- `map:getCenter` - Core map provider
- `layer:visibilityChange` - Core layer event
- `plugin:draw:getActiveFeature` - DrawTool plugin provider
- `custom:analytics:trackEvent` - Custom event for external integration

---

## Config Action Strings

Some tools accept an action as a plain string in their mission configuration —
Title's action buttons, for instance — rather than wiring a handler in code.
These strings resolve through one shared resolver
(`src/essence/Tools/_shared/actions/resolveAction.ts`), so config authors read
the same request names documented above instead of a second, tool-specific
vocabulary.

| Form | Resolves to |
|------|-------------|
| `https://…` or `http://…` | Opens in a new tab (`noopener,noreferrer`) |
| `panels:show:<panelId>` / `panels:hide:<panelId>` | `request('panels:show' \| 'panels:hide', { panelId })` |
| `plugins:show:<pluginId>` / `plugins:hide:<pluginId>` | `request('plugins:show' \| 'plugins:hide', { pluginId })` |
| anything else | `emit(action)` as a plain event |

```javascript
// Title tool config
{
    "actionButtonLink": "panels:hide:left-panel"
}
```

Only these four single-target verbs are expressible as a config string —
`setState` takes both a target and a state, which a colon-delimited string has
no escaping rules for. A mission that needs a specific target state does it in
code, not config.

A target may itself contain colons; everything after the verb is taken as the
target whole, so `panels:hide:group:left` hides a panel literally named
`group:left`, not a group called `left`. Under a reserved namespace (`panels:`,
`plugins:`, `core:`, matched exactly — `Panels:hide:left` is not treated as a
core action), an unrecognized verb or a missing target is reported with
`console.warn` naming the supported actions, rather than silently falling
through to `emit` — a typo under a reserved namespace is a config mistake
worth surfacing, not a custom event.

`core:` is reserved outright: it defines no verbs, so any `core:<verb>:<target>`
string — including the `core:showPlugin:<id>`, `core:togglePanel`, and
`core:unloadPlugin` syntax some mission configs still use — is reported with
`console.warn` and the list of supported actions above, rather than falling
through to a plain `emit` that nothing listens for. There is no drop-in
replacement for every verb: panels only expose separate show/hide actions,
and unloading a plugin needs a state argument that a colon-delimited string
can't carry — those calls belong in code, not a config string.

A string with no colon at all has no namespace, so it resolves like any other
non-core action — a plain `emit` of exactly what was written. That is legal
but seldom what an author means: every tool publishes under
`plugin:<toolId>:`, so a bare word like `refresh` emits an event named
`refresh` that no tool listener is subscribed to. It is emitted anyway and
reported with `console.warn`, naming the fully qualified form instead —
otherwise the button looks wired up and does nothing.

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
