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
window.mmgisAPI.emit('plugin:my-plugin:dataUpdated', {
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
const cleanup = window.mmgisAPI.provide('plugin:my-plugin:getData', (params) => {
    return {
        value: params.id * 2,
        timestamp: Date.now()
    }
})

// Later, remove the provider
cleanup()
```

### `mmgisAPI.request(name, params, options)`

Request data from a provider.

**Parameters:**
- `name` (string): Provider name
- `params` (any): Parameters to pass to the provider
- `options` (object, optional): How the request is made, as opposed to what it asks for
  - `options.caller` (string, optional): Id of the plugin asking, handed to the provider beside `params` rather than mixed into it, so a payload of any shape reaches the provider as it was written. Plugins do not pass this themselves — `forPlugin(id).request(...)` stamps it, which is the only reason it says anything (see Scoped `request` below)

**Returns:** Promise resolving to the provider's response

**Throws:** Error if no provider is registered for the name, or if `options` is given as anything but an object

The third argument is an object rather than one more positional slot because more than one thing belongs there: the caller now, and per-request settings such as the timeout a sandboxed plugin's requests travel with. Positionally those are indistinguishable, so a value in that slot that is not an object is refused outright rather than read as an absent caller — an unstamped request opens a popup the plugin that asked for it can never retract.

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

This asks whether this build of core offers the capability, not whether core is
currently in a state to serve it. The panel and plugin providers, for instance,
register at page load and read `true` with no layout mounted at all. Use it to
guard against a core too old to know the name; read the request's own answer —
an empty listing, or a `layout-inactive` refusal — for whether there is
anything there right now.

---

## Plugin Scoped API

MMGIS injects a scoped API as `this.api` into each tool it loads. It prefixes event and provider names with `plugin:{pluginId}:`, where `pluginId` is the id the tool declares in its own `config.json`:

```json
{
    "name": "FetchStats",
    "id": "fetch-stats"
}
```

That declaration is the tool's whole identity — the same string names it on the bus, in `plugins:show:<pluginId>` and friends, and in the `plugins:destroyed` its teardown fires. MMGIS mints the handle from it before the tool's `initialize()` runs and releases it after the tool's `destroy()` returns, unregistering every provider the handle registered. Anything a tool subscribes to straight on `window.mmgisAPI` sits outside the handle and stays the tool's own to remove.

> **Note:** An id must match `/^[a-z][a-z0-9-]*$/`, and no two tools may answer to the same one: the build refuses to generate the tool registry, and loading a mission whose live tools resolve to one id throws, both naming the pair that collided. One identity means one instance — a mission cannot run two instances of the same tool.

Both layouts mint from the same declared id, so a tool answers to one identity whichever one loads it. The modern layout mints a handle each time it loads the tool and releases it when the tool is destroyed. The classic layout mints once per page load, holds the handle for the mission, and releases it on a mission swap without minting a replacement — a classic tool that must outlive a swap has to subscribe on `window.mmgisAPI` directly.

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
const api = window.mmgisAPI.forPlugin('my-plugin')

// This emits 'plugin:my-plugin:dataUpdated'
api.emit('dataUpdated', { value: 42 })

// Subscribers listen using the full path
window.mmgisAPI.on('plugin:my-plugin:dataUpdated', (data) => {
    console.log(data.value) // 42
})
```

### Scoped `provide(name, handler)`

Register a provider with auto-prefixed name.

**Returns:** Cleanup function

```javascript
const api = window.mmgisAPI.forPlugin('my-plugin')

// This registers 'plugin:my-plugin:getData'
const cleanup = api.provide('getData', (params) => {
    return { result: params.input * 2 }
})

// Callers request using the full path
const data = await window.mmgisAPI.request('plugin:my-plugin:getData', { input: 21 })
console.log(data.result) // 42

// Later, remove the provider
cleanup()
```

### Scoped `request(name, params)`

Make a request stamped with the plugin's id.

The name is **not** prefixed, unlike `emit` and `provide`: a request names someone else's provider, not one of this plugin's, and prefixing it would put `map:showPopup` out of reach. What the handle adds is the plugin's id: it fills the `caller` option, so the id travels beside the params and tells the provider who is asking.

```javascript
const api = window.mmgisAPI.forPlugin('my-plugin')

// Reaches 'map:hidePopup' under that exact name, with 'my-plugin'
// stamped on as the caller.
await api.request('map:hidePopup')
```

Prefer this to `window.mmgisAPI.request(...)`: some providers answer differently for a caller they cannot identify. A request made straight on `mmgisAPI` carries no id, so `map:hidePopup` retracts only a popup that was opened the same anonymous way.

### Metadata Properties

The scoped API also exposes metadata:

```javascript
const api = window.mmgisAPI.forPlugin('my-plugin')

console.log(api.pluginId) // 'my-plugin'
console.log(api.prefix)   // 'plugin:my-plugin:'
```

### Complete Plugin Example

```javascript
// MyPluginTool.js - its config.json declares { "id": "my-plugin" }, and
// ToolController injects this.api minted from that id
const MyPluginTool = {
    _cleanups: [],

    initialize() {
        // this.api is available here (auto-injected)
        // Register providers (auto-prefixed to 'plugin:my-plugin:getData')
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
        // Emit events (auto-prefixed to 'plugin:my-plugin:updated')
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
| `panels:changed` | `{ panels }` | Fired whenever the panel layout changes — a panel registered or unregistered, changed state, lost a tool, or was resized — and once with an empty listing when the layout is torn down |
| `plugins:changed` | `{ plugins }` | Fired whenever a plugin is shown, hidden, loaded or unloaded by command, once after a batch of plugins loads with the layout, and once with an empty listing when the layout is torn down |
| `plugins:destroyed` | `{ pluginId }` | Fired as one plugin's instance is torn down — unloaded by command, replaced in its container, or cleared along with every other plugin when the layout re-renders |
| `plugins:allDestroyed` | `{ pluginIds }` | Fired once after a full teardown — the layout re-rendering, or the UI going down — naming every plugin instance that was destroyed. Not fired when nothing was loaded |

`panels` carries the same listing [`panels:getAll`](#panel-and-plugin-providers)
returns, and `plugins` the same listing `plugins:getAll` returns, so there is
nothing to re-request. Setting something to the state it already holds is a
quiet no-op — no event fires.

Tearing a layout down — a mission swap, for instance — fires each event once
more, carrying an empty listing. The bus outlives the layout, so a plugin that
subscribed is still subscribed after the panels and plugins it was following
are gone; the empty listing is what tells it so. Only that final listing goes
out, never the intermediate half-dismantled layouts, and a request made from
here on agrees with it: `panels:getAll` and `plugins:getAll` return empty
listings and every panel or plugin command refuses with `layout-inactive`.

So a subscriber cannot assume a panel or plugin it knows about is still in the
listing it receives:

```javascript
window.mmgisAPI.on('panels:changed', ({ panels }) => {
    const mine = panels.find((p) => p.id === 'left-panel')
    // Absent once the panel is unregistered, and once the layout is torn down.
    if (mine == null) return
    console.log(`left-panel is now ${mine.state}`)
})
```

A component that seeds from `panels:getAll` and also subscribes to
`panels:changed` must guard the seed so it cannot overwrite state an event
has already delivered — the request can resolve after a later event lands.

`plugins:destroyed` and `plugins:allDestroyed` report the teardown itself
rather than the listing that results from it. Both are signals a core service
releases shared resources on — the map popup, for one, closes there.
`pluginId` is the identity the departing plugin spoke to services under, so a
release matched against it reaches only what that plugin held and a surviving
plugin's stays put. The collective signal releases outright, because with
every plugin destroyed the resource's owner is among them and no surviving
plugin pays for the release. A teardown a command asked for is followed by
`plugins:changed` carrying the new listing.

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
    title: 'Crater A', // heading, rendered as text on the close control's row
    html: '<p>Diameter: 12 km</p>', // body, sanitized and given a shadow root of its own
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

The request holds:

| Field | Required | Meaning |
|-------|----------|---------|
| `latlng` | yes | Where the popup is anchored, tracked as the map moves |
| `title` | no | Heading, rendered as text on the close control's row. Never HTML: markup in a title arrives as the characters it was written with, the same way a button label does |
| `html` | no | Body, sanitized by the core before it reaches the DOM |
| `primaryAction` | no | Filled button, first in the actions row |
| `secondaryAction` | no | Outlined button, last in the actions row |

The anchor is the only field a request always carries. Beyond it a card is a `title`, an `html`, or both — buttons are not content, so a request holding neither has nothing to show and is rejected.

The result is `{ action }`:

| `action` | Meaning |
|----------|---------|
| `'primary'` | The primary button was pressed |
| `'secondary'` | The secondary button was pressed |
| `'dismiss'` | The user dismissed the popup with the X, with Escape, or with a click elsewhere on the map |
| `'closed'` | The popup went away without the user acting on it: another `map:showPopup` replaced it, `map:hidePopup` retracted it, a plugin was torn down, or the mission switched |

Ownership decides who may *retract* a popup, never who may open one. A request made through a plugin's handle carries the plugin's id (see Scoped `request` above), and `map:hidePopup` retracts only the popup its own caller opened — answering `false` when the slot holds someone else's popup, or nothing — so a plugin asking through its own handle can call it blind on teardown. Prefer the handle to a bare `mmgisAPI.request(...)`: an id-less request opens a popup that any other id-less caller can retract, and an id-less blind hide on teardown can retract theirs.

The request rejects — showing nothing — when it is invalid (`latlng` must hold finite numbers in range, `title` and `html` must be strings when given, and one of the two must be there) or when the popup could not be mounted. A title of nothing but whitespace reads as no title, and a card with a title takes its accessible name from it rather than from the generic one a title-less card carries. An action renders only when its `label` is a non-empty string; two actions render as equal-width buttons with the primary first, and a lone action takes the primary styling whichever field it arrived in, still answering with its own slot. The popup tracks its anchor as the map pans and hides for the length of the 2D engine's zoom animation, returning once the zoom settles.

A click elsewhere on the map dismisses the popup on the task after that click, and which side of it a replacement lands on is what decides the earlier request. Shown in the click's own task — or after an `await` that settles within it — the replacement wins and the earlier request resolves `'closed'`. Shown from a later task, such as a timer or an `await` on a real round trip, it arrives after the dismissal and the earlier request resolves `'dismiss'`. Either way the plugin is told, exactly once.

**What a card may hold**

`html` is sanitized with DOMPurify's defaults and mounted in a shadow root of its own, which is what makes a card an author's to style: a `<style>` inside `html` is honoured, and its rules — `:hover`, `@keyframes`, all of it — reach the card's content and stop there. The app around the card is untouched, and the theme's custom properties and the card's typography still cross the boundary inwards, so a card that styles nothing looks like the app it opened over.

In: text and structure, tables, `<details>`/`<summary>`, `<img>`, `<picture>`, `<video>`, `<audio>`, `<track>`, `<map>`/`<area>` image maps, MathML, and the whole of static SVG — gradients, patterns, masks, markers, filters and the `fe*` primitives included — carrying `class`, `id`, `style`, `data-*`, `aria-*` and `role`. Form controls and `<canvas>` render too, as inert content: the contract carries no script, so nothing reads a field back or paints a canvas, and a `<form>` that tries to submit is stopped before it can navigate.

Out: whatever DOMPurify's defaults refuse — scripts, event handlers, `javascript:` urls, `<iframe>`, `<object>`, `<embed>` and the SMIL animation elements — and, on top of them, the `popover` and `popovertarget` attributes, which would lift content into the browser's top layer where the card's clipping cannot follow. The one default the card overrides in the other direction is `<style>`, which DOMPurify strips whole and the card gives back, the shadow root being what makes a stylesheet safe to hand an author.

A link that goes anywhere opens in a tab of its own: the core sets `target="_blank"` and `rel="noopener noreferrer"` on every `<a>` and `<area>` `href` — and every SVG `xlink:href` — that is not a bare `#fragment`, so following a link in a card never navigates the app away. A bare fragment is left as the author wrote it. Fragment lookup never enters a shadow tree, so a `#` link in a card reaches none of the card's own ids; the most it can do is select an element of the app by id and put the fragment in the address bar, which navigates nothing.

**The card as a dialog**

An open popup is a dialog. It carries `role="dialog"`, focus moves onto the card as it opens, Tab and Shift+Tab cycle within it — through the plugin's own links and controls in their place — and focus returns to whatever held it when the popup closes, unless the user has moved focus somewhere of their own in the meantime. Escape, pressed while focus is inside the card, closes the popup and answers `'dismiss'`, exactly as the X does. A card with a `title` takes its accessible name from it; one without carries `aria-label="Map popup"`.

Focus is trapped, but nothing is laid over the rest of the app: a pointer is still free to click anywhere while a popup is open.

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
`collapsed`/`hidden`.

`panels:show` only ever lifts a panel out of `collapsed`. Anything else already
counts as visible, so the panel is left exactly where it is and the result
reports `changed: false` — which is what stops it from moving a panel the user
expanded down to whatever smaller state the configuration defaults to.

`iconified` counts as visible under that rule, and every stock layout starts its
left panel there. So "reveal the panel I live in" is two steps, not one: show
it, then read the `state` the result carries and ask for a larger one if an
icon rail is not enough. Reading the result is the general pattern — `show`
reports where the panel actually ended up, which is not always where the caller
wanted it.

```javascript
const shown = await window.mmgisAPI.request('panels:show', { panelId: 'left-panel' })
if (shown.ok && shown.state === 'iconified') {
    await window.mmgisAPI.request('panels:setState', {
        panelId: 'left-panel',
        state: 'expanded',
    })
}
```

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
`bad-request` is a malformed payload: a missing or non-string id, or a state
name outside the vocabulary in the table above. Note the difference between the
last two — a state that does not exist anywhere is `bad-request`, your mistake,
while a real state this particular target forbids is `state-not-allowed`. The
payload is judged first, so a command carrying both an unknown id and an
unrecognised state reports `bad-request`. `load-failed` is any `plugins:*` command
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
const mine = panels.find((p) => p.toolIds.includes('my-plugin'))

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
            window.mmgisAPI.provide('plugin:my-plugin:getData', handler1),
            window.mmgisAPI.provide('plugin:my-plugin:setData', handler2),
        ]
    }
}
```

### 4. Use `this.api` for Auto-Namespacing

Every tool either layout loads has a scoped API automatically injected as `this.api`. Use it for emitting events and providing handlers:

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
