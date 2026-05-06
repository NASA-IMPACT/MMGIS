# MMGIS Plugin Development Guideline (for Coding AIs)

**Audience**: Coding agents (Claude Code, Cursor, Copilot, etc.) building or modifying an MMGIS Tool plugin under `src/essence/Tools/<ToolName>/`.

**Purpose**: Keep plugins decoupled from MMGIS core, visually consistent, and safe to merge. If you cannot satisfy a rule below, **stop and flag it** — do not work around it.

**Reference plugin**: [src/essence/Tools/Chart/](src/essence/Tools/Chart/) — the canonical layout this guide describes.

**Governing ADRs** (read these if you disagree with a rule below — that's where the rule comes from):

| ADR | Topic | Drives |
|---|---|---|
| [docs/adr/20260209-plugin-communication-model.md](docs/adr/20260209-plugin-communication-model.md) | Unified Event Bus + req/resp on `mmgisAPI` | §0.3, §2, §4.1 |
| [docs/adr/02102026-maps-engine-architecture.md](docs/adr/02102026-maps-engine-architecture.md) | Pluggable `IMapEngine` (Leaflet / deck.gl / Mapbox) | §4.2 |
| [docs/adr/02102026-styling.md](docs/adr/02102026-styling.md) | USWDS + a small overridable token set | §3 |
| [docs/adr/02102026-layout-handling.md](docs/adr/02102026-layout-handling.md) | Multi-panel layout (PanelManager_) — *deferred, not yet merged* | not codified yet |

---

## 0. TL;DR — the hard rules

1. **Build a standalone React component first.** "Standalone" means *the component*, not an app — a single React component (plus children) that any other React app could `import` and render with plain props. The MMGIS wrapper is a separate file that mounts this component via ReactDOM and adapts it to the MMGIS plugin lifecycle.
2. **Never modify core, and never reach into core.** Anything outside `src/essence/Tools/<YourTool>/` is off-limits to *both* edits and direct reads. No `Map_.map.*`, no `L_.layers.*`, no `import` from `Basics/` or `Ancillary/`, no peeking into another tool's exports. If a needed API or event isn't exposed on the bus, write a blocker entry — that is the *only* legitimate reason to request a core change, and a human reviewer decides.
3. **The Event Bus is the single plugin↔core surface.** Everything — notifications, data lookups, map control, layer state, time, terrain queries, cross-plugin calls — flows through `window.mmgisAPI` (pub/sub `on / off / emit`, req/resp `provide / request`, scoped via `mmgisAPI.forPlugin(id)`). Authoritative spec: [docs/adr/20260209-plugin-communication-model.md](docs/adr/20260209-plugin-communication-model.md). Forbidden in new code: `document.dispatchEvent`, `L_.subscribe*`, `ToolController_.getTool(...)`, plugin-to-plugin JS imports, direct `Map_.map.*` / `L.map` / `Deck` calls. The engine factory `mapEngineRegistry.getActiveEngine()` is an **escape hatch**, not the default — see §4.2.
4. **Strict styling segregation, theme-ready.** Match Figma exactly, use USWDS tokens/components where applicable, scope every selector under your tool's root class, and route every color/spacing/radius through a CSS custom property (e.g. `var(--mmgis-surface, #1f2024)`) so a future theme file can flip them centrally. No hard-coded hex / px values outside the root tokens block.

The rest of this document expands these rules and gives the do/don't details.

---

## 1. Standalone React component + MMGIS wrapper

### What this means

Every plugin has **exactly two layers**, in two files:

| Layer | File | Responsibility |
|---|---|---|
| **Standalone React component** | `<ToolName>Component.tsx` | A plain React component that any React app could import and render with props. Owns the feature's UI and local UI state. **No knowledge of MMGIS.** |
| **MMGIS wrapper** | `<ToolName>.js` (the `Tool_` plugin) | Implements the MMGIS plugin lifecycle (`make` / `destroy` / `getUrlString`). Reads from `L_` / `Map_` / mission config, fetches data, and renders the React component into the MMGIS-provided DOM node via ReactDOM. |

"Standalone" here means *the component* is standalone, **not** that it ships as a separate app or package. It just must not depend on MMGIS, so it can be lifted into Storybook, the Configure UI, or any unrelated React app unchanged.

### Why

- The component is testable in isolation with React Testing Library — no MMGIS boot, no jQuery, no `L_`.
- It is reusable: another plugin, the Configure admin UI, or a future framework migration can render it directly.
- It forces a clean prop contract — the wrapper translates MMGIS state into plain props, which surfaces hidden coupling early.
- The wrapper stays small enough to read in one screen.

### Component contract

The component is the unit of work. Design its props the way a third-party React user would expect:

```tsx
// <ToolName>Component.tsx
import * as React from 'react'
import './<ToolName>Component.css'

export type <ToolName>Status = 'idle' | 'loading' | 'empty' | 'error' | 'ready'

export interface <ToolName>ComponentProps {
    status: <ToolName>Status
    data?: /* plain data shape, documented in this file */
    config?: /* plain config shape, documented in this file */
    errorMessage?: string
    emptyMessage?: string
    onSomeUserAction?: (payload: /*…*/) => void
}

export function <ToolName>Component(props: <ToolName>ComponentProps) {
    // …local UI state via useState/useReducer, render JSX
}

export default <ToolName>Component
```

### Do

- Make it a function component with hooks. Default-export it AND named-export the props type.
- Accept all inputs as plain serializable props. Document each prop's shape inline.
- Own only React state (`useState` / `useReducer`) and refs to elements you render. Use `useEffect` cleanups for any subscriptions/instances (Chart.js, ResizeObserver, …).
- Render USWDS / Figma-aligned markup; let the parent control overall sizing via CSS.
- Communicate user intent up via `on*` callback props — never reach out to MMGIS yourself.

### Don't

- ❌ Import `L_`, `Map_`, `F_`, `mmgisAPI`, or anything from `src/essence/Basics/` / `src/essence/Ancillary/` inside the component file.
- ❌ Touch `window`, `document.querySelector`, or any DOM outside the JSX subtree React renders for you.
- ❌ Make network calls from the component. Fetching is the wrapper's job; pass data in as props.
- ❌ Mutate props you were handed.
- ❌ Use class components (no reason to in new code on React 16.13+).
- ❌ Pull in a state library (Redux, Zustand, etc.) just for this component — local hooks are enough.

### Wrapper contract

The wrapper is the *only* file that knows about MMGIS. It:

1. Implements the `Tool_` shape MMGIS already expects (`make`, `destroy`, `getUrlString`, …).
2. Resolves config and data from MMGIS (`L_.layers.data[name].variables.<yourTool>`, click events, fetches).
3. Renders the React component into the `#tools` container via `ReactDOM.render`.
4. Re-renders by calling `ReactDOM.render` again with fresh props when MMGIS state changes.
5. On `destroy`, calls `ReactDOM.unmountComponentAtNode` on the container, then detaches MMGIS-side listeners.

```js
// <ToolName>.js  (MMGIS wrapper — vanilla, no JSX)
import $ from 'jquery'
import React from 'react'
import ReactDOM from 'react-dom'
import L_ from '../../Basics/Layers_/Layers_'
import <ToolName>Component from './<ToolName>Component'

const <ToolName> = {
    height: 200,
    width: 'full',
    MMGISInterface: null,
    _root: null,             // the DOM node we mount React into
    _state: {                // wrapper-side state, fed to the component as props
        status: 'idle',
        data: null,
        config: null,
        errorMessage: '',
    },

    make() {
        const tools = $('#tools')
        tools.css('background', 'var(--color-k)')
        tools.empty()
        const root = document.createElement('div')
        root.style.height = '100%'
        tools.append(root)
        this._root = root

        this._renderReact()
        // …subscribe to MMGIS events, fetch initial data, then call _setState/_renderReact
    },

    destroy() {
        if (this._root) {
            ReactDOM.unmountComponentAtNode(this._root)
            this._root.remove()
            this._root = null
        }
        // …unsubscribe MMGIS-side listeners
    },

    getUrlString() { return '' },

    _setState(patch) {
        this._state = { ...this._state, ...patch }
        this._renderReact()
    },

    _renderReact() {
        if (!this._root) return
        ReactDOM.render(
            React.createElement(<ToolName>Component, {
                status: this._state.status,
                data: this._state.data,
                config: this._state.config,
                errorMessage: this._state.errorMessage,
                onSomeUserAction: (payload) => { /* talk back to MMGIS */ },
            }),
            this._root
        )
    },
}

export default <ToolName>
```

> **React 16.13 note** — this codebase is on React 16, so use `ReactDOM.render` / `ReactDOM.unmountComponentAtNode`. Do **not** introduce `createRoot` (React 18 API) — it isn't available and pulling in a newer React is a core change, which is forbidden by §2.

> **Existing Chart tool** — at the time of writing, [src/essence/Tools/Chart/ChartComponent.js](src/essence/Tools/Chart/ChartComponent.js) is still a vanilla class for historical reasons. New tools must follow the React pattern above; the Chart component should be migrated when convenient.

---

## 2. Hands off the core

### Definition of "core"

Anything outside `src/essence/Tools/<YourTool>/`. In particular:

- `src/essence/Basics/**` (Map_, Layers_, MapEngines, TimeControl_, …)
- `src/essence/Ancillary/**`
- `src/essence/Tools/<OtherTool>/**`
- `API/**` (backend)
- `configure/**`
- Build config (`configuration/webpack.config.js`, `tsconfig.json`, `package.json` scripts)
- Any shared CSS variables or global stylesheets

### The rule

**No edits and no direct reads.** You may not modify core, and you may not import from / call into core internals (`L_.layers.*`, `Map_.map.*`, `ToolController_.getTool(...)`, `Layers_`, `TimeControl_`, another tool's exports, etc.). The communication ADR makes the bus the **only** plugin↔core surface — `mmgisAPI.on / emit / request / provide` for everything; `mapEngineRegistry.getActiveEngine()` only as the documented escape hatch in §4.2.

The single read path is mission JSON, scoped to your tool: `L_.layers.data[name].variables.<yourTool>` is the one legacy read still tolerated for per-mission config (see §5). Everything else goes through the bus.

If your plugin needs a hook (event, request handler, or `IMapEngine` capability) that doesn't exist:

1. **Stop.** Do not add the hook yourself, and do not work around it by reaching into core internals.
2. **Document the gap** in the plugin's `BLOCKERS.md` (create if missing) using the template below.
3. **Pivot** to a part of the feature that the existing APIs already support, or report back that you are blocked.

### Blocker entry template

Create `src/essence/Tools/<YourTool>/BLOCKERS.md`:

```markdown
## [BLOCKER] <one-line title>

- **Date**: YYYY-MM-DD
- **What I needed**: e.g. "An event fired when the active layer's time window changes."
- **Where I looked**: files/symbols inspected (`Map_.js`, `TimeControl_.js`, …)
- **Why existing APIs don't suffice**: short reason.
- **Proposed core change** (for a human reviewer to decide on):
  describe the minimal new API surface — name, signature, where it would live.
- **Workaround in this plugin**: what the plugin does instead (polling, no-op, degraded UX, …)
```

### Do

- Treat `mmgisAPI` as the **only** public contract. Anything you can't get from it is, by default, a blocker.
- If you need configuration, put it on the layer's `variables.<yourTool>` block in mission JSON. Read it in the wrapper via the bus where possible (`request('layers:getConfig', name)`); only fall back to a direct `L_.layers.data[name].variables.<yourTool>` read if that handler doesn't exist yet, and file a blocker proposing it.
- If a core API misbehaves, file a blocker, don't patch it.

### Don't

- ❌ Edit any file outside your tool directory, **even for typos or lint fixes**.
- ❌ Add a new export to `Map_.js`, `Layers_.js`, etc. "just for the plugin."
- ❌ Read `Map_.map.*` / `window.map.*` directly (use `request('map:*')` or, only as escape hatch, the engine factory in §4.2).
- ❌ Subscribe via `L_.subscribeTimeChange / subscribeOnLayerToggle` — use `mmgisAPI.on('time:change' / 'layer:visibilityChange', …)`.
- ❌ Call `ToolController_.getTool('Foo')` — use `mmgisAPI.request('plugin:foo:…')`.
- ❌ Reach into another tool's internals via JS `import`.
- ❌ Add new top-level dependencies in `package.json` without flagging the cost — every dep ships to all users. Prefer a peer dep already in the tree (Chart.js, D3, ECharts, Turf, Proj4 are already there).

---

## 3. Strict styling segregation (and theme-ready)

**Canonical reference**: [docs/adr/02102026-styling.md](docs/adr/02102026-styling.md). Decision: USWDS / Horizon is the chosen design system; theming is a small, well-defined set of overridable CSS variables (colors, typography, spacing) handled by core's `Theme_.js`.

### The rule

1. **USWDS first.** USWDS is the canonical design system per the styling ADR — use its tokens (colors, type scale, spacing) and components (buttons, inputs, alerts) wherever they apply. **Don't hand-roll** anything USWDS already provides.
2. **Figma overrides USWDS only when Figma is more specific.** For plugin-internal UI where Figma calls out a value, follow Figma. For shared chrome / standard controls, default to USWDS. If Figma and USWDS disagree on a fundamental value (e.g. accent color), follow Figma — note the diff in the PR.
3. **CSS lives only with the component.** One file: `<YourTool>Component.css`. Imported only by the component file. Never imported from the wrapper, never added to a global stylesheet, never edited from outside the tool directory.
4. **Scope every rule.** Every selector starts with a root class unique to your tool, e.g. `.your-tool …`. No bare element selectors, no global `*`, no `#tools` / `#toolPanel` rules. Removing the root element from the DOM must remove 100% of the plugin's visual footprint.
5. **No core CSS edits.** Do not touch `src/essence/**/*.css` outside your tool. Do not add or redefine CSS variables on `:root` — that's `Theme_.js`'s job, not yours.
6. **Theme overrides are a small, well-defined set.** The styling ADR limits operator/mission-level theme overrides to **colors, typography, and spacing**. Don't expose anything else as overridable. If Figma demands a custom shadow, radius, or layout token, bake it into your component's local tokens with a USWDS-derived default — don't surface a new mission-config knob.

### Theme-ready: every value goes through a custom property

A theme file is coming in a later PI. Plugins written today must be written so that switching the theme file flips every relevant value with **zero edits to plugin CSS**.

Inside the component CSS, declare a block of locally-scoped CSS custom properties at the root of your tool, with current Figma values as defaults, and reference those properties everywhere else:

```css
.your-tool {
  /* Local tokens — defaults today, overridable by a future theme file. */
  --your-tool-bg:           var(--mmgis-surface,        #1f2024);
  --your-tool-fg:           var(--mmgis-text,           #e6e6e6);
  --your-tool-accent:       var(--mmgis-accent,         #4fc3f7);
  --your-tool-radius-sm:    var(--mmgis-radius-sm,      4px);
  --your-tool-space-2:      var(--mmgis-space-2,        8px);
  --your-tool-font-body:    var(--mmgis-font-body,      'Source Sans Pro', sans-serif);
}

.your-tool__header {
  background: var(--your-tool-bg);
  color:      var(--your-tool-fg);
  padding:    var(--your-tool-space-2);
  border-radius: var(--your-tool-radius-sm);
}
```

The two-layer lookup (`var(--mmgis-*, fallback)`) means:
- **Today**, when no theme file is loaded, the fallback (your Figma value) wins.
- **Later**, the theme file defines `--mmgis-surface` etc. on `:root`, and every plugin picks it up automatically.

### Do

- Define a single root class on the outermost element (e.g. `.chart-tool`) and BEM-nest everything under it (`.chart-tool__header`, `.chart-tool__row`).
- Route every color, spacing, radius, font, shadow, and z-index through a `--your-tool-*` custom property declared on the root.
- Reference existing core CSS variables (e.g. `var(--color-k)`) where they already exist, behind the same `var(--mmgis-*, fallback)` pattern so the future theme can override.
- Prefix internal class names with the tool name (`.chart-tool__header`) so they cannot collide.

### Don't

- ❌ Inline a hard-coded hex, rem, or px value anywhere outside the tokens block. Every literal lives in exactly one place: the root tokens block.
- ❌ Set styles on `body`, `html`, `#tools`, `#toolPanel`, or any element you did not create.
- ❌ Use `!important` to win specificity battles with core — that means your scope is wrong, fix the scope.
- ❌ Define CSS custom properties on `:root` from a plugin. Define them on your `.your-tool` root only.
- ❌ Ship a second copy of an existing dependency for styling (no second icon font, no second reset).
- ❌ Use inline `style={{…}}` for anything theme-relevant (color, spacing, font). Inline styles bypass the theme system.

---

## 4. Approved plugin APIs (the only ones)

A plugin talks to MMGIS through exactly two surfaces. Anything else (touching `L_` directly, importing internals from `Map_`, dispatching DOM events, etc.) is forbidden in new code.

### 4.1 Communication: the unified Event Bus (`mmgisAPI`)

**Canonical reference**: [docs/adr/20260209-plugin-communication-model.md](docs/adr/20260209-plugin-communication-model.md). When in doubt, that ADR is the source of truth — this section is a working summary.
**Implementation**: [src/essence/mmgisAPI/mmgisAPI.js](src/essence/mmgisAPI/mmgisAPI.js).

#### What "the event bus" means

There is **one** plugin-facing API: `window.mmgisAPI`. It bundles two communication primitives behind a single import surface, both running through the same global instance:

| Pattern | Library | Use it for |
|---|---|---|
| **Pub/Sub** — `on / off / emit` | [`mitt`](https://github.com/developit/mitt) (200 bytes) | Notifications. Many subscribers, no return value, fire-and-forget. "Something happened." |
| **Request/Response** — `provide / request` | small custom registry of async handlers | Data lookups. Exactly one handler per name, returns a Promise. "What's the answer to X?" |

Both are exposed on `window.mmgisAPI`. There is no separate `EventBus` import. The ADR formalizes this as the "Unified Event Bus with Request/Response."

#### The bus surface

| Method | Pattern | Purpose |
|---|---|---|
| `mmgisAPI.on(event, cb)` → returns `unsubscribe()` | pub/sub | Subscribe to a notification (core or any plugin). |
| `mmgisAPI.off(event, cb)` | pub/sub | Unsubscribe (prefer the returned `unsubscribe()`). |
| `mmgisAPI.emit(event, data)` | pub/sub | Fire a notification to all listeners. |
| `mmgisAPI.provide(name, handler)` → returns `cleanup()` | req/resp | Register the (single) handler for a request name. |
| `mmgisAPI.request(name, data)` → `Promise` | req/resp | Ask the registered handler for data (async). |
| `mmgisAPI.hasHandler(name)` → `boolean` | req/resp | Existence check before calling. |
| `mmgisAPI.forPlugin(pluginId)` | scoping | Returns `{ emit, provide, pluginId, prefix }` whose `emit` and `provide` auto-prefix names with `plugin:<id>:`. Does **not** scope `on` or `request` — for those, use full paths so you can listen to / call any module. |

#### Three tiers, one API (per the ADR)

The same bus serves three different kinds of code, all using identical calls:

| Tier | Examples | Trust | Isolation | Namespace |
|---|---|---|---|---|
| **Core modules** | `Map_`, `Layers_`, `TimeControl_` | MMGIS itself | None | `map:*`, `layers:*`, `time:*`, `terrain:*`, `app:*` |
| **Core plugins** | `DrawTool`, `InfoTool`, `MeasureTool`, your `<YourTool>` | Trusted (bundled) | None — direct `window.mmgisAPI` access | `plugin:<id>:*` |
| **Marketplace plugins** (planned) | community / third-party | Untrusted | Sandboxed iframe with capability allow-list | `plugin:<id>:*` (same) |

The marketplace tier doesn't exist yet, but **plugin code you write today must work in it without modification**. The sandbox bridge translates the same `mmgisAPI.on / emit / request / provide` calls to `postMessage` transparently. This is the central design constraint of the bus and the reason for the rules below.

#### Namespace rules

| Namespace | Owned by | Plugin may | Plugin may not |
|---|---|---|---|
| `map:*`, `layers:*`, `time:*`, `terrain:*`, `app:*` | Core modules | `on(...)`, `request(...)` | `provide(...)`, `emit(...)` |
| `plugin:<id>:*` | The plugin with that id | `provide(...)`, `emit(...)` *for your own id only*; `on(...)`, `request(...)` for any id | `provide(...)` or `emit(...)` under another plugin's id |

`forPlugin(yourId)` is the mechanical guard that keeps you on the right side of the second rule. **Always use it for your own emits / provides.** Never hand-construct a `plugin:<id>:foo` string for your own messages.

#### Required usage pattern

```js
const api = window.mmgisAPI.forPlugin('your-tool')   // matches your Tools/<YourTool>/ slug
const cleanups = []

// Subscribe to a CORE-module event (full path, do NOT route through forPlugin):
cleanups.push(window.mmgisAPI.on('layer:visibilityChange', (data) => {
    /* … */
}))

// Subscribe to ANOTHER plugin's event (full path, also do NOT route through forPlugin):
cleanups.push(window.mmgisAPI.on('plugin:aoi:analysisRequested', (data) => {
    /* … */
}))

// Provide a request handler that the rest of the system can call (auto-prefixed):
cleanups.push(api.provide('getCurrentSelection', () => this._state.data))
//   ^ registers as 'plugin:your-tool:getCurrentSelection'

// Notify the world about something that happened in your plugin (auto-prefixed):
api.emit('somethingChanged', { id })
//   ^ emits 'plugin:your-tool:somethingChanged'

// Request data from a CORE module (full path):
const visible = await window.mmgisAPI.request('layers:getVisible')

// Request data from another plugin (full path):
const aoi = await window.mmgisAPI.request('plugin:aoi:getCurrentSelection')

// In destroy():
cleanups.forEach(fn => fn())
```

#### Choosing the right pattern

| You want to… | Use |
|---|---|
| Tell anyone who's interested that something happened | `emit` |
| Be notified when something happens | `on` |
| Get a value back (single source of truth) | `request` (caller) + `provide` (owner) |
| Ask "is this capability available?" | `hasHandler('namespace:name')` |

If you find yourself emitting an event and then immediately listening for a paired "response" event, you want `request/provide` instead. If you find yourself with multiple plugins all wanting to handle the same `request`, you actually want `emit/on` — `provide` is single-handler by design (last registration wins).

#### Do

- **Pick a stable `pluginId`** matching your tool directory in kebab-case (`'aoi'`, `'analysis'`, `'measure'`). Document it at the top of the wrapper.
- **Always wrap your own emits/provides through `forPlugin(yourId)`** — never hand-write `plugin:<id>:foo` for messages you own.
- **Listen and request through full paths** — `on` and `request` are not auto-scoped, on purpose, so you can talk to anyone.
- **Subscribe in `make()`, unsubscribe in `destroy()`** — capture every returned `unsubscribe` / `cleanup` in an array and run all of them on teardown.
- **Document every event your plugin emits and consumes** at the top of the wrapper. That list is your plugin's public API; future readers and marketplace listings depend on it.
- **Pass only plain serialisable data** through the bus — no DOM nodes, no class instances, no Leaflet/deck.gl handles. The marketplace bridge serialises payloads via `postMessage`; non-serialisable data will silently break in a sandboxed context.
- **Use `domain:verb` style names**: `layer:toggle`, `feature:active`, `time:change`, `selectionChanged`. Lower-case; nouns/verbs joined by `:`.

#### Don't

- ❌ Use `document.dispatchEvent(new CustomEvent(...))` or `document.addEventListener` for cross-module communication. Legacy and incompatible with the marketplace bridge.
- ❌ Use `L_.subscribeTimeChange` / `L_.subscribeOnLayerToggle` / any other `L_.subscribe*` in new code — these are legacy, route through `mmgisAPI.on('time:change', …)` / `'layer:visibilityChange'` etc.
- ❌ Reach into another plugin's internals via JS imports — call `mmgisAPI.request('plugin:other-tool:something')` instead.
- ❌ Bypass `forPlugin()` and emit unprefixed plugin events — collisions with core or other plugins are silent.
- ❌ `provide(...)` or `emit(...)` under a namespace you don't own (e.g. registering `provide('layers:foo', …)` as a plugin). Reserved namespaces are owned by core modules.
- ❌ Pass non-serialisable values through `emit` / `request` payloads. Convert to JSON-safe shapes first.

#### Missing-event blocker

If the event or request you need does not exist on the bus today, **do not add it to core yourself**. File a [blocker entry](#blocker-entry-template) with:

- The name you propose (`domain:verb` for core, `plugin:<id>:verb` for a plugin handler you don't own).
- Whether it's pub/sub (`emit/on`) or request/response (`provide/request`).
- Where in core it should be wired (file + symbol).
- The payload / return-value shape.
- What your plugin does in the meantime (degraded UX, polling, no-op).

A human reviewer decides whether core (or the owning plugin) gains the new name. New bus surface is the **only** core change a plugin task may propose.

### 4.2 Map interaction: bus first, engine factory only as escape hatch

**Canonical references**: [docs/adr/20260209-plugin-communication-model.md](docs/adr/20260209-plugin-communication-model.md) (the bus owns map/layers/time as reserved core namespaces) and [docs/adr/02102026-maps-engine-architecture.md](docs/adr/02102026-maps-engine-architecture.md) (the engine factory that core uses internally). Implementation: [src/essence/Basics/MapEngines/](src/essence/Basics/MapEngines/).

Old missions use Leaflet. New missions use deck.gl. Your plugin must work on both, unmodified — and per the communication ADR the way to achieve that is **the bus**, not direct adapter calls.

#### Default path — request/listen on the bus

Map state and map events are core-owned namespaces (`map:*`, `layers:*`, `time:*`, `terrain:*`). Read and listen through the bus. **No imports from `MapEngines/` in this case.**

```js
// Read: ask core via the bus
const center = await window.mmgisAPI.request('map:getCenter')
const bounds = await window.mmgisAPI.request('map:getBounds')

// Listen: subscribe via the bus, capture cleanups
cleanups.push(window.mmgisAPI.on('map:moveend', this._onMoveEnd))
cleanups.push(window.mmgisAPI.on('feature:active', this._onFeatureActive))

// Write: control is also a request, not a direct setter
await window.mmgisAPI.request('map:setView', { lat, lng, zoom })
await window.mmgisAPI.request('map:fitBounds', { bounds, padding: 120 })

// In destroy():
cleanups.forEach(fn => fn())
```

This works identically on Leaflet and deck.gl missions because core's `map:*` handlers delegate to whichever `IMapEngine` adapter is active. It will also work unchanged when this plugin runs in a sandboxed marketplace iframe (the ADR's central design constraint).

#### Escape hatch — `mapEngineRegistry.getActiveEngine()`

Some interactive operations don't yet have a `map:*` handler on the bus (drawing primitives, layer creation with custom styling, custom interaction modes). When that's the case **and only then**, you may import the engine factory and call `IMapEngine` directly:

```js
import { mapEngineRegistry } from '../../Basics/MapEngines'

const engine = mapEngineRegistry.getActiveEngine()
if (!engine) return

// Engine-agnostic call into a capability the bus doesn't expose yet:
engine.enableDrawing({ shape: 'polygon' })
```

Every such use is a **[blocker](#blocker-entry-template) candidate**. The proper fix is to add the missing `map:*` handler to core (or extend `IMapEngine` and have core expose a bus handler over it). File the blocker, then keep the workaround narrow.

`engine.getNativeMap()` is a *deeper* escape hatch — only when `IMapEngine` itself is insufficient. Same rule applies, with stronger justification needed.

The full interface contract is defined in [src/essence/Basics/MapEngines/IMapEngine.ts](src/essence/Basics/MapEngines/IMapEngine.ts). Adapters: [LeafletAdapter.ts](src/essence/Basics/MapEngines/Adapters/LeafletAdapter.ts), [DeckGLAdapter.ts](src/essence/Basics/MapEngines/Adapters/DeckGLAdapter.ts).

#### Do

- **Default to `mmgisAPI.on(...)` / `mmgisAPI.request('map:*' / 'layers:*' / 'time:*', ...)`.** Reach for the engine factory only when there is no bus handler yet.
- **Pass `LatLngLike` objects** (`{ lat, lng }`) when calling either path — the adapter handles axis-order conversion for deck.gl internally.
- **File a blocker every time you use the engine factory.** Note which `map:*` request handler should exist instead, and what its payload/return shape should be.
- **Check `ENGINE_LAYER_SUPPORT` / `engineSupportsLayer(...)`** if your plugin creates a layer type (some types only render on one engine). If your tool can't run on the active engine, render an `empty`/`error` state and emit `plugin:<id>:incompatible` — don't crash.

#### Don't

- ❌ Import `leaflet`, `L`, `deck.gl`, or `Cesium` from a plugin.
- ❌ Read `Map_.map.*`, `window.map.*`, or any other direct core handle. That is the legacy path; it skips both the bus and the adapter.
- ❌ Use `mapEngineRegistry.getActiveEngine()` for things the bus already exposes (`map:getCenter`, `map:fitBounds`, etc.) — use the bus.
- ❌ Branch on engine type (`if (engine.engineType === 'leaflet') …`). If you find yourself wanting to, the `IMapEngine` contract is missing something — file a blocker.
- ❌ Hold onto the engine instance across an engine swap. Re-fetch via `mapEngineRegistry.getActiveEngine()` on each operation, or subscribe to the engine-change event on the bus and refresh.

#### Missing-capability blocker

Two flavors:
- **Missing bus handler** — core exposes `IMapEngine` internally but no `map:*` request handler for plugins. Propose the handler name, payload, and return shape. (More common — most blockers belong here.)
- **Missing `IMapEngine` capability** — even core can't do it yet. Propose the addition to the **interface**; every adapter must implement it. Do not add it to a single adapter "for now."

---

## 5. Configuration

Per-mission configuration lives on `L_.layers.data[layerName].variables.<yourTool>` in mission JSON. Read it from the wrapper, validate it, pass plain values as props to the component. Don't invent a new config file or location — if `variables.<yourTool>` can't express what you need, file a blocker.

That's the whole rule. No more.

---

## 6. File structure (canonical)

```
src/essence/Tools/<YourTool>/
├── <YourTool>.js              # MMGIS wrapper (the "Tool_" plugin) — vanilla JS, mounts React
├── <YourTool>Component.tsx    # standalone React component, MMGIS-free
├── <YourTool>Component.css    # scoped styles, imported only by the component
├── config.json                # tool registration / defaults (if applicable)
├── BLOCKERS.md                # only if you hit a core gap
└── __tests__/
    └── <YourTool>Component.test.tsx
```

Wrapper lifecycle contract (matches existing tools):

```js
const YourTool = {
    height: 200,            // px or 'full'
    width: 'full',
    MMGISInterface: null,
    _root: null,            // host DOM node for ReactDOM.render

    make()        { /* create host node, ReactDOM.render the component, subscribe MMGIS events */ },
    destroy()     { /* ReactDOM.unmountComponentAtNode, remove host, detach listeners */ },
    getUrlString(){ /* serialize tool state for shareable URL, or '' */ },
}
```

Refer to [src/essence/Tools/New Tool Template.js](src/essence/Tools/New%20Tool%20Template.js) for the unmodified base shape — but note new tools should mount a React component inside `make()` per §1, rather than building DOM imperatively.

---

## 7. Lifecycle and cleanup

A plugin is mounted/unmounted many times in one session. Leaks compound. Cleanup is split between the React component (its own subscriptions) and the wrapper (everything React doesn't know about).

### Component side (React)

- Use `useEffect` for any subscription, observer, library instance (Chart.js, ResizeObserver, …).
- Always return the cleanup function from `useEffect`. Tear down the instance there.
- Use refs (`useRef`) for mutable handles you need across renders.
- Don't attach listeners to `document` / `window` from inside the component if a prop callback would do.

### Wrapper side (MMGIS)

- In `destroy()`, **first** call `ReactDOM.unmountComponentAtNode(this._root)` so the component's `useEffect` cleanups run, **then** remove the host node and detach MMGIS-side listeners.
- Hold every MMGIS-side listener (layer click handler, time control sub, websocket sub) on the wrapper object.
- Make `destroy()` idempotent and safe to call after a failed `make()` (guard with `if (this._root)`).

### Don't

- ❌ Re-create the host node on every state change — call `ReactDOM.render` again on the same node; React will reconcile.
- ❌ Rely on garbage collection to clean up Chart.js / Cesium / Leaflet handles — call their `.destroy()` in the `useEffect` cleanup.
- ❌ Leave timers running after `destroy()`.
- ❌ Forget to `unmountComponentAtNode` — without it, the component's `useEffect` cleanups never fire and you leak everything they own.

---

## 8. Testing

- **Component**: render with React Testing Library in jsdom, drive every status (`idle` / `loading` / `empty` / `error` / `ready`) via props, and assert on output. Verify one user interaction fires its `on*` callback with the expected payload. Verify unmounting tears down library instances (e.g. spy on `Chart.destroy`).
- **Wrapper**: integration-test only the data-translation seam — the function that turns layer config + fetch response into component props. Mock `fetch`. Don't mock `L_`/`Map_`; pass plain fixtures.
- Aim for the project's 80% coverage minimum (see `AGENTS.md` § Constitution IV).

---

## 9. Definition of Done — self-checklist

Before reporting a plugin task complete, verify each item:

- [ ] Component file is a single React function component with named-exported props type and default export.
- [ ] Component file has **zero** imports from `src/essence/Basics/`, `Ancillary/`, `mmgisAPI`, or other tools — verify with `grep -E "from '\\.\\./\\.\\./" <YourTool>Component.tsx` returning nothing.
- [ ] Component would render in an unrelated React app given only its prop types — confirm by reading the import list.
- [ ] Wrapper calls `ReactDOM.unmountComponentAtNode` in `destroy()` before removing the host node.
- [ ] **Communication**: every cross-module event goes through `window.mmgisAPI`. No `document.dispatchEvent`, no `L_.subscribe*` in new code. Plugin owns events are emitted via `mmgisAPI.forPlugin('<id>')`.
- [ ] Every `mmgisAPI.on` / `provide` returns a function stored in a cleanup list, and `destroy()` calls every cleanup.
- [ ] **Map**: every map read/listen goes through `mmgisAPI` (`request('map:*' / 'layers:*' / 'time:*')`, `on('map:moveend' / 'feature:active' / …)`). `mapEngineRegistry.getActiveEngine()` is used **only** for capabilities the bus does not yet expose, and each such use has a corresponding blocker entry. No imports of `leaflet`, `L`, `deck.gl`, or `Cesium`. No reads of `Map_.map` / `window.map` / `L_.layers.*` outside the single tolerated `variables.<yourTool>` config read.
- [ ] Plugin verified mentally (or in browser) on **both** a Leaflet-engine and a deck.gl-engine mission, OR explicitly `engineSupportsLayer`-gated with a clear empty/error state.
- [ ] `git diff --stat` shows changes **only** under `src/essence/Tools/<YourTool>/` (and possibly a tool-registration entry — flag that one explicitly in your report).
- [ ] No `package.json` changes, or new deps are explicitly justified in the PR description. No React-version bump.
- [ ] Every CSS selector starts with the tool's root class. `grep -E "^[^.{]" <YourTool>Component.css` returns nothing meaningful.
- [ ] **Theme-ready**: every literal value (color, spacing, radius, font, shadow) lives only in the root tokens block of the CSS, referenced everywhere else via `var(--your-tool-*)`. No inline style props for theme-relevant values.
- [ ] Figma spec referenced in the PR; visible diffs against Figma noted.
- [ ] USWDS components used for any standard control (button, input, alert).
- [ ] All `useEffect` hooks return cleanup functions where they own external instances.
- [ ] Tool mounts → unmounts → remounts cleanly with no console warnings (especially no "Can't perform a React state update on an unmounted component").
- [ ] All blockers (if any) recorded in `BLOCKERS.md` with the template fields filled. Missing-event proposals scoped to `mmgisAPI` core; missing-map-capability proposals scoped to `IMapEngine`.
- [ ] `npm test -- src/essence/Tools/<YourTool>` passes.
- [ ] `npm run build` (only if you actually changed build inputs) succeeds.

---

## 10. Things that look reasonable but are not

- "This selector is awkward; let me add a helper to `Map_.js`." → **No.** File a blocker — and target `IMapEngine`, not `Map_.js`.
- "I'll just call `engine.getNativeMap().something()` because the interface is missing it." → That's a blocker, not a workaround. Flag the missing `IMapEngine` capability and degrade until it lands.
- "I'll branch on `engine.engineType === 'leaflet'`." → **No.** Adapter-specific code in plugins defeats the entire factory. File a blocker against `IMapEngine`.
- "I'll add a quick `document.addEventListener('myEvent', …)` between my plugin and another." → **No.** Use `mmgisAPI.on` / `emit`. If the event you need doesn't exist on the bus, file a blocker.
- "`L_.subscribeOnLayerToggle` already works, I'll just use that." → **No.** Legacy. New code uses `mmgisAPI.on('layer:toggle', …)`. If that event isn't being emitted yet, blocker.
- "I'll bump Chart.js / React / any dep to a newer minor while I'm here." → **No.** Out of scope.
- "Core's CSS variable name is wrong, I'll rename it." → **No.** Not your tree.
- "I'll add a `console.log` for debugging." → Remove before completion.
- "I'll reuse another tool's CSS class because it looks the same." → **No.** Copy the rule into your scope or extract to USWDS-aligned tokens via a blocker request.
- "I'll inline this color since it's only used once." → **No.** Add it as a `--your-tool-*` token. Future theming has zero tolerance for inline literals.
- "The Figma is missing this state, I'll improvise." → Flag the gap, render a neutral fallback (empty/error props), do not invent visual design.

---

## 11. When in doubt

Stop and ask. A good blocker entry beats a bad core patch. The cost of pausing is one message; the cost of a quietly invasive plugin is weeks of untangling.

---

_Sections to extend later (placeholders): accessibility requirements, i18n, performance budgets, telemetry/logging conventions._
