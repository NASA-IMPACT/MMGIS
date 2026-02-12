# MMGIS Plugin Communication Model Research

**Date**: February 2026

**Purpose**: Trade study for selecting a communication model for MMGIS's enterprise plugin framework and marketplace

---

## Executive Summary

This document analyzes the top 5 successful plugin frameworks to identify the optimal communication model for MMGIS's transition to an enterprise service with a third-party plugin marketplace. Based on extensive research into VS Code, Figma, Grafana, WordPress, and Obsidian, we recommend a **Unified Event Bus with Request/Response** architecture using iframe sandboxing for untrusted marketplace plugins.

**Key Decision:** See [ADR: Plugin Communication Model](docs/adr/20260206-plugin-communication-model.md) for the formal architectural decision record.

---

## Table of Contents

1. [VS Code Extension Architecture](#1-vs-code-extension-architecture)
2. [Figma Plugin Architecture](#2-figma-plugin-architecture)
3. [Grafana Plugin Architecture](#3-grafana-plugin-architecture)
4. [WordPress Plugin Architecture](#4-wordpress-plugin-architecture)
5. [Obsidian Plugin Architecture](#5-obsidian-plugin-architecture)
6. [MMGIS Current Architecture Analysis](#6-mmgis-current-architecture-analysis)
7. [Comparative Analysis](#7-comparative-analysis)
8. [Recommendation for MMGIS](#8-recommendation-for-mmgis)

---

## 1. VS Code Extension Architecture

### Overview

VS Code uses a **process-isolated RPC (Remote Procedure Call)** communication model where extensions run in a separate Extension Host process, communicating with the main VS Code process through a well-defined API surface.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    VS Code Main Process                      │
│  ┌─────────────────┐    ┌─────────────────────────────────┐ │
│  │  Workbench UI   │◄──►│  MainThread Proxy (IPC Bridge)  │ │
│  └─────────────────┘    └──────────────┬──────────────────┘ │
└────────────────────────────────────────┼────────────────────┘
                                         │ IPC/RPC
┌────────────────────────────────────────┼────────────────────┐
│              Extension Host Process    │                     │
│  ┌─────────────────────────────────────▼──────────────────┐ │
│  │              Extension Host API Proxy                   │ │
│  └────────────────────┬───────────────────────────────────┘ │
│           ┌───────────┴───────────┬───────────────┐         │
│     ┌─────▼─────┐   ┌─────────────▼───┐   ┌───────▼─────┐   │
│     │Extension 1│   │   Extension 2   │   │ Extension N │   │
│     └───────────┘   └─────────────────┘   └─────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**Webview Communication (for UI extensions):**

```
Extension Host                          Webview (iframe)
      │                                       │
      │─── postMessage({json}) ──────────────►│
      │                                       │
      │◄── acquireVsCodeApi().postMessage() ──│
      │                                       │
```

### Communication Model

1. **Extension Host RPC**: Extensions call `vscode` API functions which are proxy objects that serialize requests and send them via IPC to the main process
2. **Webview Message Passing**: Extensions communicate with their UI (webviews) through `postMessage()` / `onDidReceiveMessage()` bidirectional messaging
3. **State Persistence**: `getState()` / `setState()` for lightweight state persistence across webview visibility changes

### Best Suited For

- Complex desktop applications with rich UI requirements
- Extensions that need deep IDE integration (language services, debugging, etc.)
- Scenarios requiring strong process isolation for stability

### Pros

- **Strong isolation**: Extension crashes don't affect main process
- **Rich API surface**: Comprehensive APIs for IDE features
- **Webview flexibility**: Full HTML/CSS/JS capability in webviews
- **State management**: Built-in persistence mechanisms
- **Type safety**: Full TypeScript support with comprehensive type definitions

### Cons

- **Complexity**: RPC/IPC adds architectural complexity
- **Latency**: Cross-process communication has overhead
- **Limited webview access**: Webviews can't directly access VS Code APIs (must message pass)
- **Security concerns**: Extensions run with full Node.js privileges (no true sandboxing)
- **Marketplace security**: Verification is limited; signatures only checked at install time

### Why It Doesn't Fit MMGIS

VS Code's process-isolated RPC model is designed for desktop applications with separate processes. MMGIS is a web application where:
- Process isolation isn't available (browser context)
- The complexity of RPC proxies is unnecessary overhead
- Webview message passing pattern is useful, but we can achieve this with simpler iframe sandboxing

### Security Model

- Repository signing (Marketplace signs extensions)
- Malware scanning before publishing
- Publisher verification (domain ownership)
- Extension block list for reported malicious extensions
- **Limitation**: No runtime sandboxing; extensions have full system access

### Sources

- [VS Code Extension API](https://code.visualstudio.com/api)
- [VS Code Webview API](https://code.visualstudio.com/api/extension-guides/webview)
- [Extension Runtime Security](https://code.visualstudio.com/docs/configure/extensions/extension-runtime-security)
- [Security and Trust in Visual Studio Marketplace](https://developer.microsoft.com/blog/security-and-trust-in-visual-studio-marketplace)

---

## 2. Figma Plugin Architecture

### Overview

Figma employs a **dual-environment sandboxed architecture** using WebAssembly (QuickJS) for plugin code execution and iframes for UI, with message passing between them.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Figma Main Application                    │
│  ┌──────────────────────────────────────────────────────┐   │
│  │              Document API (Scene Graph)               │   │
│  └──────────────────────────┬───────────────────────────┘   │
│                             │ Whitelisted APIs only          │
│  ┌──────────────────────────▼───────────────────────────┐   │
│  │          QuickJS Runtime (WebAssembly Sandbox)        │   │
│  │  ┌────────────────────────────────────────────────┐  │   │
│  │  │               Plugin code.js                    │  │   │
│  │  │    - Read/write document                        │  │   │
│  │  │    - NO browser APIs                            │  │   │
│  │  │    - NO network access                          │  │   │
│  │  └───────────────────────┬────────────────────────┘  │   │
│  └──────────────────────────┼───────────────────────────┘   │
│                             │ postMessage (strings only)     │
│  ┌──────────────────────────▼───────────────────────────┐   │
│  │              Plugin UI (iframe, null origin)          │   │
│  │    - Full browser APIs                                │   │
│  │    - NO document access                               │   │
│  │    - NO Figma API access                              │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Communication Model

1. **Sandbox → UI**: `figma.ui.postMessage(data)` sends to iframe
2. **UI → Sandbox**: `parent.postMessage({ pluginMessage: data }, '*')` sends to plugin code
3. **Sandbox → Figma**: Direct capability-based API calls (whitelisted only)

```javascript
// Plugin code (sandbox)
figma.ui.onmessage = msg => {
  if (msg.type === 'create-shapes') {
    // Access document through whitelisted API
    const rect = figma.createRectangle()
  }
}

// UI code (iframe)
document.getElementById('create').onclick = () => {
  parent.postMessage({ pluginMessage: { type: 'create-shapes' }}, '*')
}
```

### Best Suited For

- **Web-based applications** needing to run untrusted third-party code
- **Creative tools** where plugins modify a shared document model
- Applications requiring **strong security isolation** with reasonable performance
- **Marketplace environments** with user-contributed plugins

### Pros

- **Exceptional security**: WebAssembly + QuickJS provides hardware-enforced isolation
- **No escape vulnerabilities**: Objects can't be confused between sandbox and host
- **Deny-by-default**: Plugins only access explicitly whitelisted APIs
- **Simple communication**: Message passing is easy to understand and implement
- **Performance acceptable**: Slower than native JS but fast enough for plugin workloads

### Cons

- **Performance overhead**: QuickJS is interpreted, not JIT-compiled
- **WASM binary size**: Initial load requires compiling medium-size WASM
- **Debugging limitations**: Browser devtools don't work directly in sandbox
- **API surface limitations**: Can only expose what's explicitly whitelisted
- **Two-context complexity**: Developers must manage code split between sandbox and UI

### Why It Doesn't Fit MMGIS (But We Borrow From It)

Figma's WebAssembly sandbox is overkill for MMGIS:
1. **Overkill for our trust model**: Figma plugins directly manipulate the design document. MMGIS plugins primarily *visualize* data - they don't have write access to mission-critical geodata. An iframe sandbox provides sufficient isolation without WASM complexity.
2. **Dual-context adds unnecessary complexity**: Figma plugins have two parts - sandbox code (logic) and UI iframe (display). MMGIS tools are single-context UI components. Forcing a dual-context model would complicate every plugin.
3. **Performance concerns for real-time mapping**: WASM message serialization adds latency. MMGIS tools need responsive interaction with map events (`map:mousemove`, `map:click`).

**What we borrow:** We adopt Figma's *iframe sandboxing* concept for marketplace plugins, just without the WASM layer. The sandbox bridge provides the same API parity benefit.

### Security Model

- **WebAssembly isolation**: Plugin code runs in completely separate JS VM (QuickJS compiled to WASM)
- **Null origin iframes**: UI cannot make requests to figma.com
- **Capability-based access**: Only explicit, whitelisted APIs available
- **No object reference sharing**: WASM heap is separate from main thread

### Security Evolution

Figma initially used the "Realms shim" for sandboxing but discovered vulnerabilities where objects from inside/outside the sandbox could be confused. They switched to QuickJS/WebAssembly in September 2019, which provides much stronger isolation since object representations are fundamentally different.

### Sources

- [How to build a plugin system on the web and also sleep well at night](https://www.figma.com/blog/how-we-built-the-figma-plugin-system/)
- [An update on plugin security](https://www.figma.com/blog/an-update-on-plugin-security/)
- [How Plugins Run](https://developers.figma.com/docs/plugins/how-plugins-run/)
- [WebAssembly Security: The Mandatory SaaS Plugin Layer for 2025](https://medium.com/@hashbyt/https-www-hashbyt-com-blog-webassembly-security-saas-plugins-2025-187b2b4e53ba)

---

## 3. Grafana Plugin Architecture

### Overview

Grafana uses a **dual-layer frontend/backend plugin system** with React/TypeScript for frontend and Go binaries communicating via gRPC for backend functionality.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Grafana Core Server                       │
│  ┌─────────────────────────────────────────────────────┐    │
│  │              Plugin Manager / Registry               │    │
│  └───────────┬─────────────────────────────┬───────────┘    │
│              │                             │                 │
│  ┌───────────▼──────────┐   ┌──────────────▼────────────┐   │
│  │  Frontend (React)    │   │   Backend (gRPC Server)   │   │
│  │  - Panel rendering   │   │   - Query execution       │   │
│  │  - Configuration UI  │   │   - Authentication        │   │
│  │  - Data visualization│   │   - Resource handlers     │   │
│  └──────────────────────┘   └───────────────────────────┘   │
└──────────────────────────────┼──────────────────────────────┘
                               │ gRPC
┌──────────────────────────────▼──────────────────────────────┐
│                  Backend Plugin (Go Binary)                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  - QueryData()        - CheckHealth()                  │ │
│  │  - CallResource()     - SubscribeStream()              │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Communication Model

**Three Plugin Types:**

| Type | Frontend | Backend | Communication |
|------|----------|---------|---------------|
| **Datasource** | Required | Optional | Query data via gRPC; resource handlers |
| **Panel** | Required | None | Data via shared DataFrame structures |
| **App** | Required | Optional | Full application context |

**Data Flow:**
```
Frontend (DataFrame @grafana/data)
    ↓
Backend (data.Frame grafana-plugin-sdk-go)
    ↓
Wire format (Protocol Buffers via gRPC)
```

### Best Suited For

- **Data visualization platforms** with diverse data sources
- Applications requiring **server-side query execution**
- Systems needing **real-time streaming** capabilities
- Enterprise environments requiring **process isolation**

### Pros

- **True process isolation**: Backend plugins run as separate processes
- **Language flexibility**: Backend in Go, frontend in TypeScript/React
- **Streaming support**: Built-in real-time data streaming
- **Strong typing**: Protocol Buffers ensure type safety across boundaries
- **Resource constraints**: Can limit CPU/memory per plugin
- **Frontend sandbox**: Optional sandbox isolates plugin frontend code

### Cons

- **Complexity**: Two different language ecosystems (Go + TypeScript)
- **gRPC overhead**: Protocol buffer serialization adds latency
- **Development burden**: Backend plugins require Go knowledge
- **Build complexity**: Separate build pipelines for frontend/backend
- **Plugin size**: Go binaries can be large

### Why It Doesn't Fit MMGIS

Grafana's architecture is for a different use case:
1. **Backend plugins unnecessary**: MMGIS plugins are frontend UI components. They don't need server-side execution - all data access goes through the existing Express API.
2. **Go requirement is a barrier**: Requiring Go knowledge for plugin development would limit the contributor pool significantly.
3. **gRPC overhead**: The protocol buffer serialization adds complexity without benefit for our use case.

### Security Model

- **HashiCorp plugin container**: Secure process isolation
- **CPU/memory constraints**: Resource limits per plugin
- **Network restrictions**: Limited outbound access
- **Signature validation**: External plugins require signatures
- **Frontend sandbox**: Optional JavaScript context isolation

### Sources

- [Grafana Plugin System](https://deepwiki.com/grafana/grafana/11-plugin-system)
- [Datasource Plugins](https://deepwiki.com/grafana/grafana-plugin-examples/4-datasource-plugins)
- [Plugin Management](https://grafana.com/docs/grafana/latest/administration/plugin-management/)

---

## 4. WordPress Plugin Architecture

### Overview

WordPress uses a **hook-based event system** with Actions (for side effects) and Filters (for data transformation), allowing plugins to inject functionality at predefined extension points.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    WordPress Core                            │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                   Hook Registry                         │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │  Actions: wp_init, save_post, wp_footer, ...     │  │ │
│  │  │  Filters: the_content, the_title, query_vars, ...│  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  Request Lifecycle:                                          │
│  ┌─────┐   ┌────────┐   ┌─────────┐   ┌────────┐   ┌─────┐ │
│  │Init │──►│Routing │──►│ Query   │──►│Template│──►│Output│ │
│  └──┬──┘   └───┬────┘   └────┬────┘   └───┬────┘   └──┬──┘ │
│     │          │             │            │           │     │
│  do_action  apply_filters  apply_filters do_action  echo   │
│     │          │             │            │           │     │
│  ┌──▼──────────▼─────────────▼────────────▼───────────▼──┐ │
│  │                    Plugin Callbacks                    │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Communication Model

**Actions (Side Effects):**
```php
// Core fires action
do_action('save_post', $post_id, $post);

// Plugin registers callback
add_action('save_post', 'my_save_callback', 10, 2);
function my_save_callback($post_id, $post) {
    // Perform side effect (e.g., log, email, sync)
    // Returns nothing
}
```

**Filters (Data Transformation):**
```php
// Core applies filter
$title = apply_filters('the_title', $title, $post_id);

// Plugin modifies data
add_filter('the_title', 'my_title_filter', 10, 2);
function my_title_filter($title, $post_id) {
    return strtoupper($title); // MUST return modified data
}
```

**Priority System:**
- Hooks execute in priority order (lower = earlier)
- Default priority is 10
- Multiple callbacks can attach to same hook

### Best Suited For

- **Content management systems** with predictable lifecycles
- Applications needing **extensive customization points**
- **Monolithic architectures** where plugins share same execution context
- Systems prioritizing **developer ergonomics** over isolation

### Pros

- **Simplicity**: Easy to understand and implement
- **Flexibility**: Hooks at nearly every touchpoint
- **Ecosystem proven**: Powers 40%+ of the web
- **Low overhead**: No serialization, direct function calls
- **Discoverability**: Well-documented hook locations
- **Priority control**: Fine-grained execution ordering

### Cons

- **No isolation**: Plugins can interfere with each other
- **Security risk**: Full access to core systems
- **Dependency hell**: Plugin conflicts common
- **Performance cascading**: Slow plugins affect all
- **No sandboxing**: Malicious plugins have full access
- **Global state**: Encourages shared mutable state

### Why It Doesn't Fit MMGIS

WordPress hooks/filters have fundamental issues for our use case:

1. **Filters are synchronous**: MMGIS's geospatial operations are inherently async - fetching elevation tiles, querying WMS servers, running WebWorker computations. Filters can't `await`:
   ```javascript
   // This won't work - filters are synchronous
   addFilter('terrain:elevation', async (defaultVal, lat, lng) => {
       return await fetchElevationTile(lat, lng); // ❌ Cannot await
   });
   ```

2. **Sandbox incompatibility**: Filters expect synchronous return values, but sandboxed plugins communicate via `postMessage` which is async. We'd need two different APIs - filters for core, message-passing for sandboxed - fragmenting the ecosystem.

3. **Adds a second paradigm**: MMGIS already uses `CustomEvent`/`dispatchEvent` (~45 usages). Introducing filters would add a second pattern rather than consolidating around one.

### Security Model

- **Code review**: WordPress.org repository has basic review
- **No runtime isolation**: Plugins run in same PHP process
- **Trust-based**: Relies on plugin author integrity
- **Update frequency**: Security depends on plugin maintenance

### Industry Statistics (2025)

- Over 75% of top-performing plugins rely heavily on hooks
- 70%+ of developers use actions more than filters for workflow automation
- Most vulnerabilities originate from outdated or poorly coded plugins

### Sources

- [WordPress Hooks Handbook](https://developer.wordpress.org/plugins/hooks/)
- [WordPress Hooks Explained: Action vs Filter](https://www.lexo.ch/blog/2025/07/understanding-the-wordpress-hook-system-action-vs-filter-hooks-explained-for-beginners-with-plugin-example/)
- [WordPress Request Architecture and Hooks](https://www.wordfence.com/blog/2024/07/wordpress-security-research-series-wordpress-request-architecture-and-hooks/)
- [The WordPress Hooks Bootcamp](https://kinsta.com/blog/wordpress-hooks/)

---

## 5. Obsidian Plugin Architecture

### Overview

Obsidian uses a **component-based event system** where plugins extend a base Plugin class and receive an App reference providing access to core subsystems, with automatic lifecycle management and cleanup.

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Obsidian App                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                 App Reference                           │ │
│  │  ┌─────────┐  ┌──────────────┐  ┌─────────────────┐    │ │
│  │  │  Vault  │  │  Workspace   │  │  MetadataCache  │    │ │
│  │  │ (Events)│  │   (Events)   │  │    (Events)     │    │ │
│  │  └────┬────┘  └──────┬───────┘  └────────┬────────┘    │ │
│  └───────┼──────────────┼───────────────────┼─────────────┘ │
│          │              │                   │               │
│          ▼              ▼                   ▼               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              Event Subscription Layer                   │ │
│  │    registerEvent() / registerDomEvent() / register()   │ │
│  └────────────────────────────┬───────────────────────────┘ │
│                               │                             │
│  ┌────────────────────────────▼───────────────────────────┐ │
│  │                   Plugin Instance                       │ │
│  │  class MyPlugin extends Plugin {                        │ │
│  │    onload() { /* register extensions */ }               │ │
│  │    onunload() { /* auto cleanup */ }                    │ │
│  │  }                                                      │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Communication Model

**Event Subscription Pattern:**
```typescript
// Vault events (file operations)
this.registerEvent(
  this.app.vault.on('create', (file) => { /* handle */ })
);

// Workspace events (UI state)
this.registerEvent(
  this.app.workspace.on('active-leaf-change', (leaf) => { /* handle */ })
);

// MetadataCache events (content indexing)
this.registerEvent(
  this.app.metadataCache.on('changed', (file) => { /* handle */ })
);
```

**Inter-Plugin Communication:**
```typescript
// Method 1: Global namespace (not recommended)
window.myPluginAPI = { /* exported functions */ };

// Method 2: Plugin registry (recommended)
const otherPlugin = this.app.plugins.plugins['other-plugin-id'];
if (otherPlugin?.api) {
  otherPlugin.api.someFunction();
}
```

**Lifecycle Management:**
```typescript
class MyPlugin extends Plugin {
  onload() {
    // All registrations auto-cleaned on unload
    this.registerEvent(/* ... */);
    this.registerDomEvent(document, 'click', /* ... */);
    this.registerInterval(window.setInterval(/* ... */));
    this.addCommand({ /* ... */ });
  }

  onunload() {
    // Called automatically, all registrations cleaned up
  }
}
```

### Best Suited For

- **Electron-based desktop applications**
- Systems with **clear lifecycle phases** (load/unload)
- Applications where plugins need **deep integration** with core features
- Scenarios requiring **automatic resource cleanup**

### Pros

- **Clean lifecycle**: Automatic cleanup prevents memory leaks
- **Type safety**: Full TypeScript support via obsidian.d.ts
- **Event-driven**: Decoupled communication between components
- **App reference**: Single entry point to all core systems
- **Registration pattern**: Consistent API for all extension types
- **Developer experience**: Excellent documentation and tooling

### Cons

- **No sandboxing**: Plugins have full access to app internals
- **Trust required**: Users must trust plugin authors
- **Electron dependency**: Model specific to Electron apps
- **Inter-plugin coupling**: Direct API access can create dependencies
- **No marketplace verification**: Community plugins not heavily vetted

### Why It Doesn't Fit MMGIS

Obsidian's model has structural mismatches:

1. **No request/response mechanism**: Obsidian's model is pure events (fire-and-forget). MMGIS plugins frequently need to *request* data from core or other plugins:
   ```javascript
   // Current MMGIS pattern - plugins request data
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

### Security Model

- **Community-based**: Relies on community review
- **No isolation**: Plugins run in same Electron context
- **Code signing**: Not enforced for community plugins
- **Trust model**: Users manually enable community plugins

### Sources

- [Obsidian Plugin Development](https://deepwiki.com/obsidianmd/obsidian-api/3-plugin-development)
- [Obsidian Event System](https://deepwiki.com/obsidianmd/obsidian-api/5.1-event-system)
- [Obsidian Events Documentation](https://docs.obsidian.md/Plugins/Events)
- [Inter-plugin Communication](https://forum.obsidian.md/t/inter-plugin-communication-expose-api-to-other-plugins/23618)

---

## 6. MMGIS Current Architecture Analysis

### Current Tool System

MMGIS currently has a **homegrown tool plugin system** with the following characteristics:

**Tool Structure:**
```javascript
// src/essence/Tools/[ToolName]/[ToolName].js
const ToolName = {
    height: 0,
    width: 300,
    MMGISInterface: null,
    make: function() {
        this.MMGISInterface = new interfaceWithMMGIS()
    },
    destroy: function() {
        this.MMGISInterface.separateFromMMGIS()
    },
    getUrlString: function() {
        return ''
    }
}
```

**Tool Registration:**
```javascript
// src/pre/tools.js
export const toolModules = {
    IdentifierTool, LayersTool, LegendTool, InfoTool,
    SitesTool, IsochroneTool, ViewshedTool, ShadeTool,
    ChemistryTool, CurtainTool, MeasureTool, DrawTool,
    AnimationTool, /* ... */
}
```

### Current Communication Patterns

1. **Direct Module Imports**: Tools import core modules directly
   ```javascript
   import F_ from '../../Basics/Formulae_/Formulae_'
   import L_ from '../../Basics/Layers_/Layers_'
   import Map_ from '../../Basics/Map_/Map_'
   ```

2. **CustomEvents via DOM**: Used for cross-tool communication
   ```javascript
   let _event = new CustomEvent('toggleSeparatedTool', {
       detail: { toggledToolName: name, visible: true }
   })
   document.dispatchEvent(_event)
   ```

3. **WebSocket Broadcast**: Simple broadcast model for real-time sync
   ```javascript
   // API/websocket.js
   wss.broadcast = function broadcast(data, isBinary) {
       wss.clients.forEach((client) => {
           if (client.readyState === WebSocket.OPEN) {
               client.send(data, { binary: isBinary })
           }
       })
   }
   ```

4. **Global mmgisAPI**: Public API for external integration
   ```javascript
   // Exposes: map, addLayer, removeLayer, featuresContained, etc.
   ```

### Current Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    MMGIS Application                         │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                    Basics Layer                         │ │
│  │  Map_ | Layers_ | Globe_ | Viewer_ | ToolController_   │ │
│  └────────────────────────────────────────────────────────┘ │
│                          ▲                                   │
│           Direct imports │                                   │
│  ┌───────────────────────┴────────────────────────────────┐ │
│  │                     Tools Layer                         │ │
│  │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐      │ │
│  │  │Draw │ │Layer│ │Meas.│ │View │ │Shade│ │ ... │      │ │
│  │  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘      │ │
│  └────────────────────────────────────────────────────────┘ │
│                          │                                   │
│           CustomEvent    │    WebSocket                      │
│  ┌───────────────────────┴────────────────────────────────┐ │
│  │                    External Layer                       │ │
│  │             mmgisAPI | WebSocket Server                 │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Limitations for Enterprise/Marketplace

| Limitation | Impact |
|------------|--------|
| No isolation | Third-party plugins could access/modify core systems |
| No sandboxing | Malicious code could compromise entire application |
| Direct imports | Tight coupling prevents proper plugin boundaries |
| No permission system | Can't limit what plugins can access |
| Simple WebSocket | No rooms, no authentication, broadcasts to all |
| No plugin lifecycle | No proper install/uninstall/update hooks |
| No versioning | No API compatibility guarantees |

---

## 7. Comparative Analysis

### Communication Model Comparison

| Aspect | VS Code | Figma | Grafana | WordPress | Obsidian |
|--------|---------|-------|---------|-----------|----------|
| **Primary Model** | RPC + Message Passing | Sandboxed Message Passing | gRPC + React Props | Hooks (Actions/Filters) | Events + App Reference |
| **Isolation Level** | Process | WebAssembly | Process (backend) | None | None |
| **Security** | Medium | Very High | High | Low | Low |
| **Performance** | Good | Acceptable | Excellent | Excellent | Excellent |
| **Complexity** | High | Medium | High | Low | Medium |
| **Web Compatible** | Partial | Yes | Yes | Yes (server) | No (Electron) |
| **Third-party Safe** | Medium | Yes | Yes | No | No |
| **Marketplace Ready** | Yes | Yes | Yes | Yes | Partial |

### Security Model Comparison

| Aspect | VS Code | Figma | Grafana | WordPress | Obsidian |
|--------|---------|-------|---------|-----------|----------|
| **Sandboxing** | No | Yes (WASM) | Optional | No | No |
| **Code Signing** | Yes | N/A | Yes | No | No |
| **Malware Scanning** | Yes | N/A | Yes | Basic | No |
| **Publisher Verification** | Domain | N/A | Identity | Basic | No |
| **Runtime Isolation** | Process | WASM | Process | None | None |
| **API Restrictions** | Limited | Strict | Moderate | None | None |

### Suitability for MMGIS

| Framework | Relevance | Key Learnings |
|-----------|-----------|---------------|
| **VS Code** | Medium | Webview message passing pattern; extension lifecycle management |
| **Figma** | **High** | Web-based sandbox model; document API design; security architecture |
| **Grafana** | **High** | Data visualization plugins; panel architecture; frontend sandbox |
| **WordPress** | Medium | Hook system simplicity; extensive extension points; priority ordering |
| **Obsidian** | Medium | Event system patterns; lifecycle management; TypeScript integration |

---

## 8. Recommendation for MMGIS

### Recommended Architecture: Unified Event Bus with Request/Response + Sandboxed Plugins

Based on MMGIS's current architecture, web-based nature, enterprise marketplace goals, and **preference for simplicity and consistency**, we recommend a **single unified communication pattern** across three tiers.

**See [ADR: Plugin Communication Model](./adr/20260209-plugin-communication-model.md) for the full architectural decision record.**

### Design Principles

1. **One Pattern Everywhere**: Use the same Event Bus API for both core and marketplace plugins
2. **Consistency Over Complexity**: Avoid mixing hooks, filters, events, and actions - use one unified approach
3. **Familiar to MMGIS**: Builds on existing `CustomEvent`/`dispatchEvent` patterns already in the codebase
4. **Request/Response for Data**: When plugins need to retrieve or modify data, use async request/response instead of filters
5. **Use Existing Libraries**: Use `mitt` (200 bytes) for events, minimal custom code for request/response

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    MMGIS Core Application                    │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                   MMGISEventBus                         │ │
│  │  ┌──────────────────────────────────────────────────┐  │ │
│  │  │  emit()     - Fire event (notifications)         │  │ │
│  │  │  on()       - Listen to events                   │  │ │
│  │  │  request()  - Ask for data (async, returns value)│  │ │
│  │  │  provide()  - Register as data provider          │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────┘ │
│                          ▲                                   │
│            Same API      │      Same API                     │
│  ┌───────────────────────┴────────────────────────────────┐ │
│  │              Plugin Host / Permission Layer             │ │
│  └────────────────────────────────────────────────────────┘ │
│       │                     │                     │          │
│  ┌────▼──────────┐   ┌──────▼───────┐   ┌────────▼────────┐ │
│  │ Core Modules  │   │ Core Plugins │   │ Marketplace     │ │
│  │ (Map_, L_)    │   │ (DrawTool)   │   │ (sandboxed)     │ │
│  │               │   │              │   │                 │ │
│  │ map:*         │   │ plugin:draw:*│   │ plugin:chart:*  │ │
│  │ layers:*      │   │ plugin:info:*│   │ plugin:picker:* │ │
│  └───────────────┘   └──────────────┘   └─────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Three-Tier Architecture

| Tier | Examples | Trust Level | Isolation | Namespace |
|------|----------|-------------|-----------|-----------|
| **Core Modules** | `Map_`, `Layers_`, `L_` | MMGIS itself | None | `map:*`, `layers:*`, `time:*` |
| **Core Plugins** | `DrawTool`, `InfoTool`, `MeasureTool` | Trusted (bundled) | None (direct access) | `plugin:draw:*`, `plugin:info:*` |
| **Marketplace Plugins** | `datepicker`, `chart` | Untrusted (third-party) | Sandboxed iframe | `plugin:datepicker:*`, `plugin:chart:*` |

**Key distinction:**
- **Core modules** own reserved namespaces (`map`, `layers`, `time`, `terrain`, etc.)
- **All plugins** (core or marketplace) use `plugin:<id>:*` namespace
- Core vs marketplace plugins differ only in **trust level and isolation**, not API

### Core Implementation

Uses `mitt` library (200 bytes) for events, simple function registry for request/response:

```javascript
import mitt from 'mitt';

const events = mitt();
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
```

### Plugin-to-Plugin Communication

Marketplace plugins can communicate with each other using the same `provide()`/`request()` pattern, with **automatic namespace enforcement**:

```javascript
// DatePicker plugin provides data
mmgis.provide('getSelectedDate', () => selectedDate);
// Auto-namespaced to: plugin:datepicker:getSelectedDate

// Chart plugin requests from DatePicker
const date = await mmgis.request('plugin:datepicker:getSelectedDate');
```

Plugins cannot hijack core providers or other plugins' namespaces.

### Validation Strategy

**Zod validation for marketplace plugins only:**

```javascript
// In sandbox bridge (parent side)
function handlePluginEmit(pluginId, event, data) {
    const schema = eventSchemas[event];
    if (schema) {
        const result = schema.safeParse(data);
        if (!result.success) {
            console.error(`Plugin ${pluginId} emitted invalid ${event}`);
            return;
        }
    }
    mmgis.emit(event, data);
}
```

| Source | Validation | Rationale |
|--------|------------|-----------|
| Core plugins | No | Trusted code, we control the payloads |
| Marketplace plugins | Yes (Zod) | Untrusted, could be malformed/malicious |

### Sandbox Assumptions

Marketplace plugins run in sandboxed iframes:
- `sandbox="allow-scripts"` - allows JavaScript but restricts DOM access to parent
- Null origin - no access to MMGIS cookies/localStorage
- CSP headers - restricts network access to declared domains
- `postMessage` - only communication channel with parent application

### Usage Examples

#### Example 1: Layer Added Notification (Events)

```javascript
// Core emits when layer is added
mmgis.emit('layer:added', { name: 'Terrain', uuid: 'abc123' });

// Any plugin can listen
mmgis.on('layer:added', (layer) => {
    console.log(`New layer: ${layer.name}`);
});
```

#### Example 2: Getting Map Data (Request/Response)

```javascript
// Map_ (core module) provides data
mmgis.provide('map:getCenter', () => Map_.map.getCenter());
mmgis.provide('map:getBounds', () => Map_.map.getBounds());

// Any plugin can request data
const center = await mmgis.request('map:getCenter');
const bounds = await mmgis.request('map:getBounds');
```

#### Example 3: Cross-Plugin Communication

```javascript
// DrawTool (core plugin) provides its data
mmgis.provide('plugin:draw:getActiveFeature', () => DrawTool.activeFeature);

// AnalysisTool (any plugin) consumes it
const feature = await mmgis.request('plugin:draw:getActiveFeature');
if (feature) {
    runAnalysis(feature);
}
```

#### Example 4: Async Data Provider

```javascript
// Provider can do async work (geospatial queries, tile fetching, etc.)
mmgis.provide('terrain:getElevation', async ({ lat, lng }) => {
    const tile = await fetchElevationTile(lat, lng);
    return tile.getElevationAt(lat, lng);
});

// Consumer awaits the result
const elevation = await mmgis.request('terrain:getElevation', { lat, lng });
```

### Capability-Based Permission System

Capabilities control what sandboxed plugins can access:

```javascript
const CAPABILITIES = {
    // Map capabilities
    'map:read':   // Can request: map:getCenter, map:getBounds, map:getZoom
    'map:write':  // Can request: map:setCenter, map:setBounds, map:setZoom

    // Layer capabilities
    'layers:read':   // Can request: layers:getAll, layers:getData
    'layers:write':  // Can request: layers:add, layers:remove, layers:update

    // Event capabilities
    'events:on:map:*':     // Can subscribe to: map:click, map:move, map:zoom
    'events:on:layer:*':   // Can subscribe to: layer:added, layer:removed
    'events:emit:custom:*': // Can emit custom events

    // Plugin dependencies
    'plugin:datepicker:read': // Can request from datepicker plugin

    // UI capabilities
    'ui:panel':  // Can create side panel
    'ui:modal':  // Can show modals

    // Network capabilities
    'network:fetch': { domains: ['api.example.com'] }
};
```

### Migration Path

#### How Current Patterns Map to New API

All 4 existing communication mechanisms can be migrated to the unified Event Bus:

| Current Pattern | New Pattern | Difficulty |
|-----------------|-------------|------------|
| `L_.subscribe*` | `mmgis.on()` | Easy |
| `CustomEvent` | `mmgis.emit/on` | Easy |
| `getTool()` | `mmgis.request/provide` | Medium |
| `notifyActiveTool()` | `mmgis.emit()` | Easy |

```javascript
// Current → New
L_.subscribeOnLayerToggle(id, cb)  →  mmgis.on('layer:toggle', cb)
document.dispatchEvent(...)        →  mmgis.emit('event', data)
getTool('InfoTool').use(feature)   →  mmgis.request('plugin:info:show', f)
notifyActiveTool('feature', f)     →  mmgis.emit('feature:select', f)
```

#### Phase 1: Event Bus Foundation

1. Introduce Event Bus alongside existing CustomEvents
2. Add `window.mmgis` global with `emit`, `on`, `request`, `provide`
3. Document available events

#### Phase 2: Request Handlers for Core Services

1. Add `provide()` handlers in `Map_`, `Layers_`, `L_`, etc. (core modules)
2. Add `provide()` handlers in core plugins (`DrawTool`, `InfoTool`, etc.)
3. Replace `getTool()` calls with `request()` calls

```javascript
// In Map_.js (core module - no plugin: prefix)
mmgis.provide('map:getCenter', () => Map_.map.getCenter());
mmgis.provide('map:getBounds', () => Map_.map.getBounds());

// In InfoTool.js (core plugin - uses plugin: prefix)
mmgis.provide('plugin:info:showFeature', (feature) => InfoTool.use(feature));
```

#### Phase 3: Plugin Manifest & Lifecycle

1. Add `manifest.json` for all tools
2. Implement `onLoad`/`onUnload` lifecycle hooks
3. Move tool registration to manifest-based system

#### Phase 4: Sandbox Infrastructure

1. Implement iframe sandbox for marketplace plugins
2. Add postMessage bridge that mirrors Event Bus API
3. Capability checking and Zod validation in bridge layer (marketplace only)

#### Phase 5: Marketplace Integration

1. Plugin signing and verification
2. Capability review process
3. Plugin registry and discovery

#### Phase 6: Deprecate Legacy Patterns

1. Add deprecation warnings to `L_.subscribe*`, `getTool()`, `notifyActiveTool()`
2. Migrate remaining usages
3. Remove deprecated code in next major version

### Technology Recommendations

| Component | Technology | Size | Rationale |
|-----------|------------|------|-----------|
| **Events** | [mitt](https://github.com/developit/mitt) | 200 bytes | Battle-tested, tiny, does one thing well |
| **Request/Response** | Simple function registry | ~15 lines | Just a Map of async functions |
| **Sandbox** | iframe with null origin | Browser-native | No dependencies needed |
| **Bridge Protocol** | Structured postMessage | ~50 lines | Simple JSON messaging |
| **Validation** | [Zod](https://github.com/colinhacks/zod) | ~12KB | Marketplace plugins only |
| **Plugin Manifest** | JSON with JSON Schema | N/A | Declarative, validatable |

### Why This Approach (vs. Hooks/Filters)

| Aspect | Hooks + Filters | Unified Event Bus |
|--------|-----------------|-------------------|
| **Async support** | Filters are sync | `request()` is async-native |
| **Sandbox compatibility** | Requires separate async API | Same API, bridge is transparent |
| **Patterns to learn** | 2 (actions, filters) | 1 (events + request/response) |
| **Current MMGIS fit** | New patterns to introduce | Extends existing CustomEvent usage |
| **Geospatial data ops** | Must wrap in events | Natural fit with async request/response |

### Summary

The recommended **Unified Event Bus** approach:

1. **One pattern everywhere**: `emit/on` for notifications, `request/provide` for data
2. **Same API for all plugins**: Core and marketplace use identical methods
3. **Sandbox is transparent**: Bridge handles postMessage; plugins don't know they're sandboxed
4. **Builds on existing code**: MMGIS already uses CustomEvent - this is a cleaner version
5. **Capability-based security**: Sandboxed plugins can only access what's declared
6. **Use existing libraries**: mitt for events, minimal custom code

This architecture prioritizes:
- **Async-native design** (geospatial ops need async)
- **Sandbox API parity** (same API for both tiers)
- **Plugin promotion path** (marketplace → core with zero code changes)
- **Gradual migration** (can adopt incrementally)

---

## Appendix: Sources

### VS Code
- [VS Code Extension API](https://code.visualstudio.com/api)
- [Webview API Guide](https://code.visualstudio.com/api/extension-guides/webview)
- [Extension Runtime Security](https://code.visualstudio.com/docs/configure/extensions/extension-runtime-security)
- [vscode-messenger RPC Library](https://github.com/TypeFox/vscode-messenger)

### Figma
- [How we built the Figma plugin system](https://www.figma.com/blog/how-we-built-the-figma-plugin-system/)
- [An update on plugin security](https://www.figma.com/blog/an-update-on-plugin-security/)
- [How Plugins Run](https://developers.figma.com/docs/plugins/how-plugins-run/)
- [Creating a User Interface](https://www.figma.com/plugin-docs/creating-ui/)

### Grafana
- [Plugin System Documentation](https://deepwiki.com/grafana/grafana/11-plugin-system)
- [Datasource Plugins](https://deepwiki.com/grafana/grafana-plugin-examples/4-datasource-plugins)
- [Plugin Management](https://grafana.com/docs/grafana/latest/administration/plugin-management/)

### WordPress
- [Hooks Handbook](https://developer.wordpress.org/plugins/hooks/)
- [WordPress Hooks Bootcamp](https://kinsta.com/blog/wordpress-hooks/)
- [Request Architecture and Hooks](https://www.wordfence.com/blog/2024/07/wordpress-security-research-series-wordpress-request-architecture-and-hooks/)

### Obsidian
- [Plugin Development](https://deepwiki.com/obsidianmd/obsidian-api/3-plugin-development)
- [Event System](https://deepwiki.com/obsidianmd/obsidian-api/5.1-event-system)
- [Events Documentation](https://docs.obsidian.md/Plugins/Events)

### Security & Marketplace
- [WebAssembly Security: SaaS Plugin Layer 2025](https://medium.com/@hashbyt/https-www-hashbyt-com-blog-webassembly-security-saas-plugins-2025-187b2b4e53ba)
- [JetBrains Plugin Security](https://plugins.jetbrains.com/docs/marketplace/understanding-plugin-security.html)
- [Atlassian Marketplace Security](https://developer.atlassian.com/platform/marketplace/vendor-security-guidelines/)
