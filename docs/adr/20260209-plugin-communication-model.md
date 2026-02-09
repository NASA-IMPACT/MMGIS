# Plugin Communication Model for MMGIS Enterprise Platform

- Status: PROPOSED
- Date: 2026-02-09
- Deciders: MMGIS Core Team
- Tags: plugins, architecture, communication, marketplace, security

## Context and Problem Statement

MMGIS currently uses plugins from a local plugin repository (located in `src/essence/Tools`). We're preparing MMGIS to be an **enterprise service with a plugin framework and marketplace** which needs to support user-contributed remote plugins. This transition requires a robust communication model that:

1. Enables third-party developers to build custom visualization tools
2. Provides security isolation for untrusted marketplace plugins
3. Maintains consistency and simplicity for plugin developers
4. Builds upon MMGIS's existing architecture patterns

### Current State

MMGIS currently uses **4 distinct communication mechanisms**:

| Pattern | Usage | Example |
|---------|-------|---------|
| **L_.subscribe*** | State change subscriptions (~42 usages) | `L_.subscribeTimeChange('MyTool', cb)` |
| **CustomEvent/dispatchEvent** | Cross-component broadcast (~45 usages) | `document.dispatchEvent(new CustomEvent('toolChange', {detail}))` |
| **ToolController_.getTool()** | Direct tool access (~11 usages) | `ToolController_.getTool('InfoTool').use(feature)` |
| **notifyActiveTool()** | Core → active tool notification | `ToolController_.notifyActiveTool('feature', feature)` |

**Problems with current approach:**

| Problem | Impact |
|---------|--------|
| No central event bus | Hard to debug, trace events |
| Inconsistent patterns | Developers must learn 4 systems |
| Direct tool coupling | `getTool('InfoTool')` creates hard dependency |
| No namespacing | ID collisions possible between plugins |
| No sandboxing | Plugins have full DOM/global access |

### Limitations for Enterprise/Marketplace

| Limitation | Impact |
|------------|--------|
| No isolation | Third-party plugins could access/modify core systems |
| No sandboxing | Malicious code could compromise entire application |
| Direct imports | Tight coupling prevents proper plugin boundaries |
| No permission system | Cannot limit what plugins can access |
| No plugin lifecycle | No proper install/uninstall/update hooks |

## Decision Drivers

1. **Async-Native Data Flow**: Geospatial operations (tile queries, elevation lookups, WebWorker computations) are inherently asynchronous; the communication model must support this natively
2. **Sandbox API Parity**: Marketplace plugins in sandboxed iframes must use the same API as core plugins - two different APIs would fragment the ecosystem
3. **Plugin Promotion Path**: Battle-tested marketplace plugins should be promotable to core tier with zero code changes - only a configuration/trust change
4. **Capability-Based Security**: Permission checks must map cleanly to API calls (e.g., "can this plugin call `map:getCenter`?")
5. **Gradual Migration**: Can adopt incrementally without rewriting existing tools
6. **Existing Patterns**: Builds on MMGIS's current use of `CustomEvent`/`dispatchEvent`

## Assumptions

1. **Iframe sandboxing for marketplace plugins**: Untrusted third-party plugins will run in sandboxed iframes with restricted permissions. This provides security isolation without the complexity of WebAssembly. The iframe sandbox uses:
   - `sandbox="allow-scripts"` - allows JavaScript but restricts DOM access to parent
   - Null origin - no access to MMGIS cookies/localStorage
   - CSP headers - restricts network access to declared domains
   - `postMessage` - only communication channel with parent application

2. **Two trust tiers**: Plugins are either "core" (trusted, runs directly) or "marketplace" (untrusted, sandboxed). No intermediate trust levels initially.

3. **Plugins are UI components**: MMGIS plugins primarily render UI in panels and interact with the map. They don't need direct filesystem or database access - all data flows through the Event Bus API.

## Considered Options

### Option 1: WordPress-style Hooks and Filters

Adopt WordPress's pattern with Actions (side effects) and Filters (data transformation).

```javascript
// Actions - side effects, no return
mmgis.hooks.doAction('feature:created', feature);
mmgis.hooks.addAction('feature:created', callback, priority);

// Filters - data transformation, must return
const style = mmgis.hooks.applyFilters('feature:style', defaultStyle);
mmgis.hooks.addFilter('feature:style', modifyStyle, priority);
```

**Pros:**
- Battle-tested pattern (powers 40%+ of web)
- Priority system for execution ordering
- Filters allow data interception/modification

**Cons:**
- **Filters are synchronous** - cannot `await` async operations inside a filter callback
- Sandbox incompatibility - filters expect synchronous return values, but sandboxed plugins communicate via `postMessage` which is async
- Would require two different APIs: filters for core, message-passing for sandboxed
- Two patterns to learn (actions vs filters) with unclear guidance on when to use which

**Why it doesn't fit MMGIS:**

MMGIS's geospatial operations are inherently async - fetching elevation tiles, querying WMS servers, running WebWorker computations. A filter-based system would force awkward workarounds:

```javascript
// What we need (async terrain query)
const elevation = await getElevationAt(lat, lng);

// WordPress filters can't do this - they're synchronous:
addFilter('terrain:elevation', (defaultVal, lat, lng) => {
    // ❌ Cannot await here - must return immediately
    return fetchElevationTile(lat, lng).then(...); // Returns Promise, not value
});
```

Additionally, MMGIS currently uses `CustomEvent`/`dispatchEvent` (~45 usages) which is already event-based. Introducing filters would add a second paradigm rather than consolidating around one.

### Option 2: Obsidian-style Event System

Adopt Obsidian's component-based event system with App reference.

```javascript
class MyPlugin extends Plugin {
    onload() {
        this.registerEvent(this.app.vault.on('create', handler));
        this.registerEvent(this.app.workspace.on('active-leaf-change', handler));
    }
    onunload() { /* auto cleanup */ }
}
```

**Pros:**
- Clean lifecycle management
- Automatic cleanup on unload
- TypeScript-friendly

**Cons:**
- No return values from events - plugins can only listen, not request data
- Requires class-based plugin architecture
- Events are scoped to specific objects (`vault.on`, `workspace.on`)

**Why it doesn't fit MMGIS:**

1. **No request/response mechanism**: Obsidian's model is pure events (fire-and-forget). MMGIS plugins frequently need to *request* data from core or other plugins:
   ```javascript
   // Current MMGIS pattern - plugins request data from other plugins
   const feature = ToolController_.getTool('DrawTool').getActiveFeature();

   // Obsidian can't do this - events don't return values
   ```

2. **Class-based architecture mismatch**: MMGIS tools are function/object-based modules, not classes:
   ```javascript
   // Current MMGIS tool pattern
   const MyTool = {
       make: function() { ... },
       destroy: function() { ... }
   };

   // Obsidian requires class inheritance
   class MyPlugin extends Plugin { ... }
   ```
   Adopting Obsidian's pattern would require rewriting all 16 existing tools.

3. **Object-scoped events add complexity**: Obsidian scopes events to objects (`vault.on`, `workspace.on`). MMGIS would need to expose `mmgis.map.on`, `mmgis.layers.on`, etc., adding conceptual overhead vs a single flat event bus.

### Option 3: Figma-style Sandboxed Message Passing

Adopt Figma's dual-environment architecture with WebAssembly sandbox.

```javascript
// Plugin code (sandbox) → UI (iframe)
figma.ui.postMessage(data);

// UI (iframe) → Plugin code (sandbox)
parent.postMessage({ pluginMessage: data }, '*');
```

**Pros:**
- Exceptional security (WebAssembly isolation)
- Proven for marketplace with untrusted code
- No object reference leaking

**Cons:**
- Two separate contexts to manage (sandbox + UI)
- Performance overhead from WASM
- Complex debugging across contexts
- Steep learning curve for plugin developers

**Why it doesn't fit MMGIS:**

1. **Overkill for our trust model**: Figma uses WASM sandboxing because plugins directly manipulate the design document. MMGIS plugins primarily *visualize* data - they don't have write access to mission-critical geodata. An iframe sandbox provides sufficient isolation without WASM complexity.

2. **Dual-context adds unnecessary complexity**: Figma plugins have two parts - sandbox code (logic) and UI iframe (display). MMGIS tools are single-context UI components that render in a panel. Forcing a dual-context model would complicate every plugin:
   ```javascript
   // Figma: plugin logic in sandbox, UI in iframe, must coordinate
   figma.ui.postMessage({ type: 'updateChart', data });

   // MMGIS: tool is just a UI component, no separation needed
   $('#chart').updateData(data);
   ```

3. **Performance concerns for real-time mapping**: WASM message serialization adds latency. MMGIS tools need responsive interaction with map events (`map:mousemove`, `map:click`). The added overhead would degrade UX for tools like Measure or Draw.

4. **We still borrow the good part**: We adopt Figma's *iframe sandboxing* concept for marketplace plugins, just without the WASM layer. The sandbox bridge provides the same API parity benefit.

### Option 4: Unified Event Bus with Request/Response (Recommended)

Single pattern combining events for notifications with request/response for data retrieval.

```javascript
// Notifications (fire-and-forget)
mmgis.emit('layer:added', layer);
mmgis.on('layer:added', callback);

// Data retrieval (async, returns value)
const center = await mmgis.request('map:getCenter');
mmgis.provide('map:getCenter', () => Map_.map.getCenter());
```

**Pros:**
- **Async-native**: `request()` returns a Promise, enabling handlers to perform async operations (fetch tiles, query databases, run WebWorkers)
- **Sandbox parity**: Same API works in both direct and sandboxed contexts - the postMessage bridge is transparent to plugin developers
- **Clean capability mapping**: Each `request()` call maps directly to a capability check (e.g., `map:read` allows `map:getCenter`)
- Familiar to MMGIS (already uses CustomEvent pattern)

**Cons:**
- No priority system for events (can be added if needed)
- Request handlers are single-registration (last handler wins - warns on overwrite)

**Why it fits MMGIS:**

1. **Natural evolution of existing patterns**: MMGIS already uses `CustomEvent`/`dispatchEvent` (~45 usages) and subscription callbacks (~42 usages). This pattern consolidates both into a single, consistent API rather than introducing something foreign.

2. **Maps directly to current usage**:
   ```javascript
   // Current MMGIS patterns → New unified pattern
   L_.subscribeOnLayerToggle(id, cb)           →  mmgis.on('layer:toggle', cb)
   document.dispatchEvent(new CustomEvent(...)) →  mmgis.emit('tool:change', data)
   ToolController_.getTool('Info').use(f)      →  mmgis.request('plugin:info:show', f)
   ```

3. **Handles MMGIS's async reality**: Geospatial operations (tile fetching, elevation queries, WMS requests) are inherently async. The `request()`/`provide()` pattern handles this naturally:
   ```javascript
   mmgis.provide('terrain:getElevation', async ({ lat, lng }) => {
       const tile = await fetchElevationTile(lat, lng);
       return tile.getElevationAt(lat, lng);
   });
   ```

4. **No architectural rewrite required**: Existing tools keep their current structure (object-based, not class-based). They just add event subscriptions and request handlers alongside existing code during incremental migration.

## Decision Outcome

**Chosen option: Option 4 - Unified Event Bus with Request/Response**

### Primary Rationale

#### 1. Async-Native Design for Geospatial Operations

MMGIS plugins frequently need to perform asynchronous operations:
- Query tile servers for elevation data
- Fetch remote GeoJSON layers
- Run computations in WebWorkers
- Access IndexedDB caches

**Filters are fundamentally synchronous:**
```javascript
// WordPress-style filter - BLOCKING, cannot await
const style = applyFilters('feature:style', defaultStyle);
// All callbacks must return immediately - no async allowed
```

**Request/Response is async by design:**
```javascript
// Event bus style - handlers can do async work
const elevation = await mmgis.request('terrain:getElevation', { lat, lng });

// Handler can query tile server, cache, etc.
mmgis.provide('terrain:getElevation', async ({ lat, lng }) => {
    const tile = await fetchElevationTile(lat, lng);
    return tile.getElevationAt(lat, lng);
});
```

#### 2. Sandbox API Parity is Technically Required

Sandboxed plugins communicate via `postMessage`, which is inherently asynchronous. With filters:

```javascript
// This CANNOT work in a sandbox:
addFilter('feature:style', (style) => {
    return modifiedStyle; // Synchronous return expected
    // But postMessage is async - how do you return a value?
});
```

You would end up with **two different APIs**:
- Filters for core plugins (synchronous)
- Message-passing for sandboxed plugins (async)

This fragments the plugin ecosystem. With request/response, **both use the same async pattern**:

```javascript
// Works identically in core AND sandbox
const style = await mmgis.request('feature:getStyle', feature);
```

The sandbox bridge translates this to `postMessage` transparently - plugin code is identical.

#### 3. Capability Checks Map Directly to Requests

With request/response, permission checking is straightforward:

```javascript
// In sandbox bridge
async request(requestType, data) {
    // Direct mapping: request type → capability
    if (!this.capabilities.includes('map:read') && requestType.startsWith('map:get')) {
        throw new Error(`Capability denied: ${requestType}`);
    }
    // Forward to parent
    return await this._sendToParent(requestType, data);
}
```

With filters, capability checking is more complex - you'd need to intercept the filter chain and determine which modifications are allowed.

#### 4. Seamless Plugin Promotion (Marketplace → Core)

A key requirement is the ability to **promote battle-tested marketplace plugins to core** after proper vetting. The unified API makes this trivial:

**Marketplace plugin code:**
```javascript
// Running in sandboxed iframe
mmgis.on('map:click', handleClick);
const layers = await mmgis.request('layers:getVisible');
mmgis.emit('analysis:complete', results);
```

**Same plugin promoted to core:**
```javascript
// Running directly in main context - ZERO CODE CHANGES
mmgis.on('map:click', handleClick);
const layers = await mmgis.request('layers:getVisible');
mmgis.emit('analysis:complete', results);
```

**Promotion process:**
1. Plugin proves stable in marketplace (usage metrics, user reviews, no security issues)
2. Code review and security audit
3. Change `manifest.json`: `"tier": "marketplace"` → `"tier": "core"`
4. Move from sandbox to direct loading
5. **No plugin code changes required**

**With hooks/filters, this wouldn't work** - sandboxed plugins would need a different async API (message-passing), so promotion would require rewriting plugin internals to use synchronous filters. This creates friction against plugin promotion and fragments the ecosystem into "sandbox-style" and "core-style" plugins.

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    MMGIS Core Application                    │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                   MMGISEventBus                         │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │  emit()      - Fire event (notifications)        │  │ │
│  │  │  on()        - Listen to events                  │  │ │
│  │  │  request()   - Ask for data (async)              │  │ │
│  │  │  provide()   - Register as data provider         │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────┘ │
│                          ▲                                   │
│            Same API      │      Same API                     │
│  ┌───────────────────────┴────────────────────────────────┐ │
│  │              Plugin Host / Permission Layer             │ │
│  └────────────────────────────────────────────────────────┘ │
│           │                                   │              │
│   Trusted │                          Untrusted│              │
│  ┌────────▼─────────┐          ┌──────────────▼───────────┐ │
│  │  Tier 1: Core    │          │  Tier 2: Marketplace     │ │
│  │  (Direct Access) │          │  (Sandboxed Iframe)      │ │
│  │                  │          │                          │ │
│  │  mmgis.emit()    │          │  mmgis.emit()  ────────┐ │ │
│  │  mmgis.on()      │          │  mmgis.on()       │     │ │
│  │  mmgis.request() │          │  mmgis.request()  │     │ │
│  │                  │          │         ▼         │     │ │
│  │                  │          │  [postMessage bridge]   │ │
│  └──────────────────┘          └──────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Three-Tier Architecture

MMGIS distinguishes between **core modules**, **core plugins**, and **marketplace plugins**:

| Tier | Examples | Trust Level | Isolation | Namespace |
|------|----------|-------------|-----------|-----------|
| **Core Modules** | `Map_`, `Layers_`, `L_` | MMGIS itself | None | `map:*`, `layers:*`, `time:*` |
| **Core Plugins** | `DrawTool`, `InfoTool`, `MeasureTool` | Trusted (bundled) | None (direct access) | `plugin:draw:*`, `plugin:info:*` |
| **Marketplace Plugins** | `datepicker`, `chart` | Untrusted (third-party) | Sandboxed iframe | `plugin:datepicker:*`, `plugin:chart:*` |

**Namespace Examples:**
```javascript
// Core modules (not plugins - part of MMGIS core)
map:getCenter
map:getBounds
layers:getVisible
layers:toggle
time:getCurrent

// Core plugins (trusted tools - bundled with MMGIS)
plugin:draw:getActiveFeature
plugin:info:showFeature
plugin:measure:getDistance

// Marketplace plugins (untrusted - third party)
plugin:datepicker:getSelectedDate
plugin:chart:refresh
```

**Key distinction:**
- **Core modules** own reserved namespaces (`map`, `layers`, `time`, `terrain`, etc.)
- **All plugins** (core or marketplace) use `plugin:<id>:*` namespace
- Core vs marketplace plugins differ only in **trust level and isolation**, not API

**Plugin Lifecycle:**
```
┌─────────────────┐      Vetting &       ┌─────────────────┐
│   Marketplace   │ ──────Review──────►  │  Core Plugin    │
│   (sandboxed)   │                      │    (direct)     │
│                 │ ◄────Demotion─────── │                 │
│  • Community    │   (if issues found)  │  • Bundled      │
│  • Capability-  │                      │  • Full access  │
│    restricted   │                      │  • Audited      │
└─────────────────┘                      └─────────────────┘
        │                                        │
        └──────── SAME API (no code changes) ────┘
                  Same namespace: plugin:<id>:*
```

### Consequences

**Positive:**
- Async operations supported natively - critical for geospatial data fetching
- Same API for core and sandboxed plugins - no ecosystem fragmentation
- **Zero-friction plugin promotion**: marketplace → core requires only config change, no code rewrite
- Capability checking maps directly to request types
- Clear separation between notifications (`emit/on`) and data (`request/provide`)
- Existing tools can migrate incrementally
- Simpler mental model than hooks + filters + events

**Negative:**
- No priority ordering for event listeners (can be added if needed)
- Request handlers are single-registration (last handler wins, unlike filter chains)
- Cannot intercept/modify data mid-flow like filters (must use request/response pattern instead)

## Implementation Details

### Implementation Approach: Use Existing Libraries

Rather than building a custom event bus from scratch, we use **battle-tested libraries** for the core functionality:

| Component | Library | Size | Purpose |
|-----------|---------|------|---------|
| Events (pub/sub) | [mitt](https://github.com/developit/mitt) | 200 bytes | Fire-and-forget notifications |
| Request/Response | Simple function registry | ~15 lines | Async data retrieval |
| Sandbox Bridge | Custom | ~50 lines | Translates API to postMessage |
| Validation (marketplace) | [zod](https://github.com/colinhacks/zod) | ~12KB | Runtime payload validation |

### Why This Split?

- **Events** and **Request/Response** are fundamentally different primitives:
  - Events: Many listeners, no return value, fire-and-forget
  - Request/Response: One handler, returns data, async
- `mitt` handles events perfectly - no need to reinvent
- Request/Response is just a map of async functions - trivial to implement

### Core Implementation

```javascript
import mitt from 'mitt';

// Events: use mitt (200 bytes, battle-tested)
const events = mitt();

// Request/Response: simple function registry
const handlers = new Map();

const mmgis = {
    // ============ EVENTS (via mitt) ============
    on: events.on,
    off: events.off,
    emit: events.emit,

    // ============ REQUEST/RESPONSE ============
    provide(name, handler) {
        if (handlers.has(name)) {
            console.warn(`Handler "${name}" is being replaced`);
        }
        handlers.set(name, handler);
        return () => handlers.delete(name);
    },

    async request(name, data) {
        const handler = handlers.get(name);
        if (!handler) {
            throw new Error(`No handler for: "${name}"`);
        }
        return await handler(data);
    },

    hasHandler(name) {
        return handlers.has(name);
    }
};

export default mmgis;
```

**Total custom code: ~15 lines** (plus mitt at 200 bytes)

### API Terminology Note

We use `provide()` instead of `onRequest()` to better convey intent:
- `provide('map:getCenter', fn)` - "I provide this data"
- `request('map:getCenter')` - "I request this data"

### Usage Examples

**Layer Added Notification (Events):**
```javascript
// Core emits notification
mmgis.emit('layer:added', { name: 'Terrain', uuid: 'abc123' });

// Any plugin can listen (multiple listeners OK)
mmgis.on('layer:added', (layer) => {
    console.log(`New layer: ${layer.name}`);
});
```

**Getting Map Data (Request/Response):**
```javascript
// Map_ provides data (one provider per request type)
mmgis.provide('map:getCenter', () => Map_.map.getCenter());
mmgis.provide('map:getBounds', () => Map_.map.getBounds());

// Any plugin can request (multiple consumers OK)
const center = await mmgis.request('map:getCenter');
const bounds = await mmgis.request('map:getBounds');
```

**Cross-Plugin Communication:**
```javascript
// DrawTool (core plugin) provides its data
mmgis.provide('plugin:draw:getActiveFeature', () => DrawTool.activeFeature);

// AnalysisTool (any plugin) consumes it
const feature = await mmgis.request('plugin:draw:getActiveFeature');
```

**Async Data Provider:**
```javascript
// Provider can do async work
mmgis.provide('terrain:getElevation', async ({ lat, lng }) => {
    const tile = await fetchElevationTile(lat, lng);
    return tile.getElevationAt(lat, lng);
});

// Consumer awaits the result
const elevation = await mmgis.request('terrain:getElevation', { lat, lng });
```

### Sandbox Bridge (Marketplace Plugins)

The bridge makes sandboxed plugins use the **exact same API**:

```javascript
// Injected into sandboxed iframe by MMGIS
class SandboxBridge {
    constructor(capabilities) {
        this.capabilities = capabilities;
        this.pending = new Map();
        this.requestId = 0;
        this.localListeners = new Map();

        window.addEventListener('message', (e) => this._handleMessage(e));
    }

    // Events - same API as core
    on(event, callback) {
        if (!this._canSubscribe(event)) {
            console.warn(`Capability denied: subscribe to ${event}`);
            return () => {};
        }
        this.localListeners.set(event, callback);
        parent.postMessage({ type: 'mmgis:subscribe', event }, '*');
        return () => this.off(event, callback);
    }

    emit(event, data) {
        if (!this._canEmit(event)) return;
        parent.postMessage({ type: 'mmgis:emit', event, data }, '*');
    }

    // Request/Response - same API as core
    async request(name, data, timeout = 5000) {
        if (!this._canRequest(name)) {
            throw new Error(`Capability denied: ${name}`);
        }
        const id = ++this.requestId;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`Request "${name}" timed out`));
            }, timeout);

            this.pending.set(id, { resolve, reject, timer });
            parent.postMessage({ type: 'mmgis:request', id, name, data }, '*');
        });
    }

    // Note: sandboxed plugins cannot use provide() - they are consumers only
}
```

**Note:** Sandboxed plugins can `provide()` data, but only within a namespaced scope (see [Plugin-to-Plugin Communication](#plugin-to-plugin-communication)). They cannot override core data providers.

### Plugin-to-Plugin Communication

Marketplace plugins can communicate with each other using the same `provide()`/`request()` pattern, but with **automatic namespace enforcement** to prevent hijacking core providers.

**Use Case Example:**
```
DatePicker plugin (marketplace) → provides selected date
Chart plugin (marketplace) → requests date to fetch chart data
```

**How it works:**

```javascript
// DatePicker plugin registers a provider
mmgis.provide('getSelectedDate', () => selectedDate);
// Internally namespaced to: plugin:datepicker:getSelectedDate

// Chart plugin requests from DatePicker
const date = await mmgis.request('plugin:datepicker:getSelectedDate');
```

**Namespace Enforcement in Sandbox Bridge:**

```javascript
// In sandbox bridge - plugin side
provide(name, handler) {
    // Automatically namespace to prevent core hijacking
    const namespacedName = `plugin:${this.pluginId}:${name}`;
    parent.postMessage({
        type: 'mmgis:provide',
        name: namespacedName,
        // Handler stays in plugin, bridge routes requests back
    }, '*');
    return () => {
        parent.postMessage({ type: 'mmgis:unprovide', name: namespacedName }, '*');
    };
}

request(name, data) {
    // Plugins can request from core OR other plugins
    // Core: 'map:getCenter'
    // Plugin: 'plugin:datepicker:getSelectedDate'
    if (!this._canRequest(name)) {
        throw new Error(`Capability denied: ${name}`);
    }
    // ... rest of request logic
}
```

**Security guarantees:**

| Provider | Namespace | Who can override? |
|----------|-----------|-------------------|
| Core modules (`Map_`, `Layers_`) | `map:*`, `layers:*` | Only MMGIS core code |
| Core plugins (`DrawTool`, `InfoTool`) | `plugin:draw:*`, `plugin:info:*` | Only that plugin |
| Marketplace plugins (`datepicker`) | `plugin:datepicker:*` | Only that plugin |

All plugins (core or marketplace) follow the same `plugin:<id>:*` pattern. The difference is trust level and isolation, not the API.

**Capability for plugin-to-plugin:**

Plugins must declare which other plugins they depend on:

```json
{
    "id": "chart-plugin",
    "capabilities": [
        "map:read",
        "plugin:datepicker:read"
    ]
}
```

This allows the permission system to:
1. Warn users about plugin dependencies
2. Block requests to undeclared plugin namespaces
3. Show dependency graph in marketplace UI

### Capability System

```javascript
const CAPABILITIES = {
    'map:read':          // request: map:getCenter, map:getBounds, map:getZoom
    'map:write':         // request: map:setCenter, map:setBounds
    'layers:read':       // request: layers:getAll, layers:getVisible
    'layers:write':      // request: layers:add, layers:remove
    'events:on:map:*':   // subscribe: map:click, map:move, map:zoom
    'events:on:layer:*': // subscribe: layer:added, layer:removed
    'events:emit:custom:*': // emit custom events
    'ui:panel':          // create side panel
};
```

### Validation Strategy: Marketplace Only

We use **Zod** for runtime payload validation, but **only for marketplace plugins**:

```javascript
// In the sandbox bridge (parent side)
function handlePluginEmit(pluginId, event, data) {
    // Validate payload from untrusted source
    const schema = eventSchemas[event];
    if (schema) {
        const result = schema.safeParse(data);
        if (!result.success) {
            console.error(`Plugin ${pluginId} emitted invalid ${event}:`, result.error);
            return; // Block malformed event
        }
    }

    // Forward validated event
    mmgis.emit(event, data);
}
```

**Why marketplace only?**

| Source | Validation | Rationale |
|--------|------------|-----------|
| Core plugins | No | Trusted code, we control the payloads |
| Marketplace plugins | Yes (Zod) | Untrusted, could be malformed/malicious |

**Performance consideration:** High-frequency events (`map:move`, `map:mousemove`) from sandboxed plugins can skip validation or use a simpler check:

```javascript
const HIGH_FREQUENCY_EVENTS = ['map:move', 'map:mousemove'];

function handlePluginEmit(pluginId, event, data) {
    if (!HIGH_FREQUENCY_EVENTS.includes(event)) {
        validateWithZod(event, data);
    }
    mmgis.emit(event, data);
}
```

### Plugin Manifest

```json
{
    "id": "community-analysis-tool",
    "name": "Advanced Analysis",
    "version": "1.0.0",
    "tier": "marketplace",
    "capabilities": [
        "map:read",
        "layers:read",
        "events:on:map:*",
        "ui:panel"
    ],
    "entry": "index.js"
}
```

## Migration Path

### How Current Patterns Map to New API

All 4 existing communication mechanisms can be migrated to the unified Event Bus:

```
┌─────────────────────────────────────────────────────────────────────┐
│                       MIGRATION MAPPING                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  L_.subscribeTimeChange(id, cb)     →  mmgis.on('time:change', cb)  │
│  L_.subscribeOnLayerToggle(id, cb)  →  mmgis.on('layer:toggle', cb) │
│  L_.unsubscribeTimeChange(id)       →  unsubscribe() return value   │
│                                                                      │
│  document.dispatchEvent(...)        →  mmgis.emit('event', data)    │
│  document.addEventListener(...)     →  mmgis.on('event', cb)        │
│                                                                      │
│  getTool('InfoTool').use(feature)   →  mmgis.request('plugin:info:show', f)│
│                                                                      │
│  notifyActiveTool('feature', f)     →  mmgis.emit('feature:select',f)│
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### Migration Difficulty by Pattern

| Current Pattern | New Pattern | Difficulty | Notes |
|-----------------|-------------|------------|-------|
| `L_.subscribe*` | `mmgis.on()` | Easy | Same concept, different syntax |
| `CustomEvent` | `mmgis.emit/on` | Easy | Already event-based |
| `getTool()` | `mmgis.request/provide` | Medium | Better decoupling |
| `notifyActiveTool()` | `mmgis.emit()` | Easy | More flexible - any tool can listen |

### Phase 1: Event Bus Foundation
1. Introduce Event Bus alongside existing patterns (both work simultaneously)
2. Add `window.mmgis` global with `emit`, `on`, `request`, `provide`
3. Document available events

```javascript
// Before
L_.subscribeTimeChange('MyTool', callback);
document.dispatchEvent(new CustomEvent('toolChange', { detail }));

// After
mmgis.on('time:change', callback);
mmgis.emit('tool:change', detail);
```

### Phase 2: Request Handlers for Core Services
1. Add `provide()` handlers in `Map_`, `Layers_`, `L_`, etc. (core modules)
2. Add `provide()` handlers in core plugins (`DrawTool`, `InfoTool`, etc.)
3. Replace `getTool()` calls with `request()` calls
4. Document available requests

```javascript
// In Map_.js (core module - no plugin: prefix)
mmgis.provide('map:getCenter', () => Map_.map.getCenter());
mmgis.provide('map:getBounds', () => Map_.map.getBounds());
mmgis.provide('map:setView', ({ center, zoom }) => Map_.map.setView(center, zoom));

// In InfoTool.js (core plugin - uses plugin: prefix)
mmgis.provide('plugin:info:showFeature', (feature) => InfoTool.use(feature));

// Replaces: ToolController_.getTool('InfoTool').use(feature)
await mmgis.request('plugin:info:showFeature', feature);
```

### Phase 3: Plugin Manifest & Lifecycle
1. Add `manifest.json` for all tools
2. Implement `onLoad`/`onUnload` lifecycle
3. Move tool registration to manifest-based system

### Phase 4: Sandbox Infrastructure
1. Implement iframe sandbox for marketplace plugins
2. Add postMessage bridge mirroring Event Bus API
3. Capability checking and **Zod validation** in bridge layer (marketplace only)

### Phase 5: Marketplace Integration
1. Plugin signing and verification
2. Capability review process
3. Plugin registry and discovery

### Phase 6: Deprecate Legacy Patterns
1. Add deprecation warnings to `L_.subscribe*`, `getTool()`, `notifyActiveTool()`
2. Migrate remaining usages
3. Remove deprecated code in next major version

## Links

- [Research Document](../plugins-communication-research.md) - Full trade study with detailed analysis
- [VS Code Extension API](https://code.visualstudio.com/api)
- [Figma Plugin Security](https://www.figma.com/blog/an-update-on-plugin-security/)
- [WordPress Hooks](https://developer.wordpress.org/plugins/hooks/)
- [Obsidian Plugin API](https://docs.obsidian.md/Plugins/Events)
