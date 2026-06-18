---
name: mmgis-monorepo-tool-pattern
description: Use when refactoring an MMGIS tool in src/essence/Tools/ to the tinacms-portal-monorepo conventions, OR when building a new MMGIS tool from scratch in those conventions. Covers TypeScript per-component dirs, BEM with `blocks-` prefix, global Sass (not CSS Modules), USWDS theme tokens, the MMGIS adapter pattern, modern-tool-pattern config, and React 19 `createRoot` mounting.
---

# MMGIS Tool — TinaCMS Monorepo Pattern

A repeatable procedure for producing an MMGIS interactive tool that matches the engineering conventions of `~/repo/impact/tinacms-portal-monorepo/packages/blocks/`. Works for both **refactoring** existing tools and **building new tools from scratch**.

The `lib/` directory of any tool produced this way is portable: it can be `git mv`-ed into the monorepo (`packages/blocks/src/geo/<Tool>/` or `packages/blocks/src/components/<Tool>/`) with near-zero changes.

## When to use

Invoke when the user asks to:

- "Refactor `<Tool>` to the monorepo pattern"
- "Convert this tool to TypeScript + the new layout"
- "Build a new tool called `<Foo>` that does X" (use greenfield mode)
- "Make this look like CardDetailed in the monorepo"
- "Apply the tinacms standards to `<path>`"
- Anything where the user references **the monorepo pattern**, **BEM + blocks-**, **modern tool pattern**, or **the LayerManager pattern**

Don't invoke for unrelated MMGIS work (other tool features, bug fixes, config-only changes).

## Two modes

### Refactor mode

**Trigger:** target tool path already has legacy files (`.js`, `.jsx`, flat `components/` / `hooks/` / `utils/` dirs, `.css` files).

**Pre-step:** read the legacy code to identify:
- Domain types (what data shapes the components consume)
- Sub-components (what's the visual hierarchy)
- Event subscriptions (what `window.mmgisAPI.on(...)` calls or equivalent)
- Action handlers (what mutations the tool triggers)

Use these as input to the shared procedure (step 1 onward).

### Greenfield mode

**Trigger:** target tool path is empty or doesn't exist; user is describing a new tool.

**Pre-step:** propose component decomposition, domain types, and API surface BEFORE writing code:

> Before I write code, here's what I'm planning. Confirm or adjust:
> - **Sub-components:** A, B, C with roles X, Y, Z.
> - **Domain types:** `<TypeName>` shape...
> - **Top-level component API:** `<ToolName>Panel({ data, loading, onAction1, onAction2 })`.
> - **MMGIS state sources:** `mmgisRequest('foo:getBar')`, subscribes to `'foo:changed'`.
> - **MMGIS state mutations:** `mmgisRequest('foo:setBar')`, emits `'foo:changed'` after.

If auto-mode is active and the spec is clear, proceed without confirmation but state assumptions in one short paragraph before starting. If the spec is loose ("build a tool that shows histogram of pixel values"), ask clarifying questions BEFORE proposing.

## Pre-flight checks (both modes)

Run these and confirm before any file writes:

```bash
# 1. React 19
node -e "console.log(require(process.cwd() + '/node_modules/react/package.json').version)"
# Expect: 19.x

# 2. USWDS Sass available
ls node_modules/@uswds/uswds/packages/uswds-core 2>&1
# Expect: a directory listing

# 3. sass-loader includePaths configured for USWDS
grep -A 5 "sassOptions" configuration/webpack.config.js | head -20
# Expect: includePaths pointing at @uswds/uswds/packages

# 4. typecheck baseline (note pre-existing errors so refactor isn't blamed)
npm run typecheck 2>&1 | tail -5

# 5. **Theming mode detection** — determines which theming path to use
ls src/styles/*/index.scss 2>&1 | head -5
# If present (multiple pre-compiled themes at src/styles/<theme>/): use **Path A — CSS variables**.
# If absent (no global theme infrastructure): use **Path B — self-contained Sass tokens**.
```

If any pre-flight fails (e.g., React 16 still installed), STOP and flag — the pattern assumes React 19 + USWDS Sass already set up. Setup work belongs in a separate effort, not this skill's scope.

## Theming: Path A vs Path B

The skill supports two theming approaches; the right one depends on whether MMGIS has the global per-theme bundle infrastructure already in place.

### Path A — CSS variables (recommended when MMGIS has `src/styles/<theme>/`)

MMGIS pre-compiles per-theme CSS bundles at `dist/<theme>.css` (via `scripts/build-themes.sh` or equivalent) and loads the active bundle at runtime (e.g., `UserInterfaceModern_.init` calls `require(\`dist/${theme}.css\`)`). The bundles emit `:root { --theme-color-*; --theme-spacing-*; --theme-font-*; … }` from a shared `_theme-export.scss` mixin.

In this mode the tool's lib **does not ship any theme configuration**. Component partials reference theme values via CSS custom properties:

```scss
.blocks-foo {
    color: var(--theme-color-ink, #1b1b1b);
    padding: var(--theme-spacing-1, 0.5rem);
    background: var(--theme-color-base-lightest, #f0f0f0);
}
```

Benefits: tool reactively re-themes when the mission changes theme; no duplicate USWDS framework CSS in the JS bundle (the runtime theme bundle owns it); no `@use 'theme-tokens'` plumbing in any component file.

### Path B — Sass functions (legacy / standalone)

MMGIS has no global theme bundles. The tool ships its own `lib/styles/theme-tokens.scss` and uses `color('primary')` etc. inside component partials — values bake into the JS-bundle CSS at compile time. The tool always renders in its baked theme regardless of mission settings.

Use this mode only when **pre-flight check 5 fails** (no `src/styles/<theme>/index.scss`). Once MMGIS adopts Path A, a follow-up should migrate the tool — the substitution is mechanical: `color('X')` → `var(--theme-color-X, fallback)`, `units(N)` → `var(--theme-spacing-N, …)`, etc.

The templates and procedure below show both. Pick the one that matches your pre-flight result; do not mix.

## Architecture: lib/ vs adapters/

The hard boundary that defines portability:

- **`lib/`** is the React library. **Zero** references to `window.mmgisAPI`, `jQuery`, `ReactDOM`, MMGIS CSS variables (`var(--color-a..l)`), or any MMGIS global. Components receive data via props and emit changes via callback props. This directory moves to the monorepo on extraction.
- **`adapters/`** is the MMGIS-coupled glue. Event-bus subscriptions, MMGIS API requests, state-mutating handlers. Stays in MMGIS forever.
- **`MMGIS<Tool>Adapter.tsx`** is a React component that owns state and bridges the two. Reads from `adapters/`, passes state to `lib/`.
- **`<Tool>Tool.tsx`** is the MMGIS tool module — a thin mount/unmount + modern-tool-pattern shim.

```
src/essence/Tools/<Tool>/
├── <Tool>Tool.tsx                       # MMGIS tool wrapper — mount/unmount, modern pattern
├── MMGIS<Tool>Adapter.tsx               # Owns state, subscribes to event bus, calls handlers
├── adapters/                            # MMGIS-coupled glue (stays in MMGIS forever)
│   ├── mmgisAPI.ts                      # Typed window.mmgisAPI wrappers
│   ├── useMMGISEvent.ts                 # event-bus subscription hook
│   ├── useMMGISToolVars.ts              # 'tool:getVars' as a hook
│   ├── build<Tool>Data.ts               # pure transform: MMGIS data → lib props
│   ├── get<Tool>Data.ts                 # orchestrator: pulls data via mmgisAPI
│   └── handlers.ts                      # change handlers (visibility, opacity, etc.)
├── lib/                                 # PORTABLE library — extraction target
│   ├── geo/                             # mirrors monorepo packages/blocks/src/geo/
│   │   ├── <Component1>/<Component1>.tsx
│   │   ├── <Component2>/<Component2>.tsx
│   │   └── ... one folder per component, .tsx only
│   ├── hooks/                           # internal — not re-exported
│   ├── utils/                           # internal — not re-exported
│   ├── styles/
│   │   ├── index.scss                   # manifest — see "lib/styles/index.scss" section
│   │   ├── theme-tokens.scss            # Path B ONLY (omit for Path A)
│   │   ├── scss-imports.d.ts            # `declare module '*.scss'`
│   │   └── components-geo/              # PLAIN .scss (no .module.) — one file per component
│   │       ├── index.scss               # aggregator — @use each component partial
│   │       ├── <component-1-kebab>.scss
│   │       └── <component-2-kebab>.scss
│   ├── types.ts                         # shared domain types
│   └── index.ts                         # public exports (components + types only)
└── config.json                          # MMGIS tool registration + modern-layout metadata
```

**Key naming choices, matched against the monorepo:**

- Components live under `lib/geo/<Name>/<Name>.tsx`, mirroring `packages/blocks/src/geo/`. (Non-geo MMGIS tools — buttons, banners — would live at `lib/components/<Name>/<Name>.tsx` mirroring `packages/blocks/src/components/`, but this is rare.)
- Component styles in `lib/styles/components-geo/` with a separate `index.scss` aggregator. The aggregator is **pure** (just `@use 'each-partial';`) — no theme manifest concerns.
- `lib/styles/index.scss` is the theme **manifest** — what goes in it depends on Path A vs B (see section below).

## Per-component templates

### TSX (`lib/<Component>/<Component>.tsx`)

```tsx
import React from 'react'
import type { /* domain types */ } from '../types'
import { ChildComponent } from '../ChildComponent/ChildComponent' // if any

export type <Component>Props = {
    /** JSDoc on each prop. */
    propA: string
    propB?: number
    onSomething?: (arg: string) => void
}

export function <Component>({ propA, propB, onSomething }: <Component>Props) {
    return (
        <div className="blocks-<component-kebab>">
            <div className="blocks-<component-kebab>__header">{propA}</div>
            <button
                className={`blocks-<component-kebab>__action ${active ? 'blocks-<component-kebab>__action--active' : ''}`}
                onClick={() => onSomething?.('hi')}
            >
                Click
            </button>
        </div>
    )
}
```

**Conventions in TSX:**
- 4-space indentation.
- `import React from 'react'` is REQUIRED at the top of every `.tsx` file. MMGIS's webpack dev build uses classic JSX runtime; production build uses automatic and tolerates omission — so `npm run build` passes while `npm start` fails. Easy to miss.
- `<Component>Props` exported alongside the component. JSDoc on each prop.
- All callbacks optional unless intrinsic. Empty rendering when a callback is absent.
- Class-name strings are plain — no template-imported `styles.xxx` lookups.
- Conditional class composition: `` `base ${cond ? 'base--mod' : ''}` ``.
- MMGIS/USWDS global classes (`mdi mdi-*`, `mmgisLoading`, `usa-button`) stay as-is — they're outside our naming domain.

### Sass (`lib/styles/components-geo/<component-kebab>.scss`)

#### Path A — CSS variables (recommended)

```scss
.blocks-<component-kebab> {
    display: flex;
    padding: var(--theme-spacing-105, 0.75rem);
    background: var(--theme-color-white, #ffffff);
    color: var(--theme-color-ink, #1b1b1b);

    &__header {
        padding: var(--theme-spacing-1, 0.5rem) var(--theme-spacing-105, 0.75rem);
        background: var(--theme-color-base-lighter, #dfe1e2);
        border-bottom: 1px solid var(--theme-color-base-light, #a9aeb1);
        font-size: var(--theme-font-size-sm, 0.93rem);
    }

    &__action {
        display: flex;
        align-items: center;
        background: transparent;
        border: none;
        color: var(--theme-color-base, #71767a);
        cursor: pointer;
        transition: all 0.15s ease;

        &:hover {
            background: var(--theme-color-base-lightest, #f0f0f0);
            color: var(--theme-color-base-darker, #3d4551);
        }

        &--active {
            background: var(--theme-color-primary, #0e7482);
            color: var(--theme-color-white, #ffffff);
        }
    }
}
```

**Conventions for Path A:**
- **NO `@use` statements at top of component partials.** No `@use 'theme-tokens'`, no `@use 'uswds-core' as *;`. The component partial is pure CSS-with-Sass-nesting; theming comes from CSS custom properties resolved at runtime.
- Reference tokens via `var(--theme-<category>-<token>, <fallback>)`. The fallback is for graceful degradation when no theme bundle is loaded (and during initial render before the runtime CSS injects); use a disasters-theme-ish value.
- Token names follow `_theme-export.scss` in MMGIS's `src/styles/`. Common subset:
  - **Colors**: `--theme-color-primary`, `--theme-color-secondary`, `--theme-color-base[-lightest|-lighter|-light|-dark|-darker|-darkest]`, `--theme-color-ink`, `--theme-color-white`
  - **Spacing**: `--theme-spacing-05`, `--theme-spacing-1`, `--theme-spacing-105`, `--theme-spacing-2`, `--theme-spacing-205`, … `--theme-spacing-10`
  - **Typography**: `--theme-font-size-{3xs..3xl}`, `--theme-font-weight-{light..heavy}`, `--theme-line-height-{1..6}`
  - **Radius**: `--theme-radius-{sm,md,lg,pill}`
- One block selector per file. Nest `&__element` and `&--modifier` inside (BEM with the `blocks-` prefix).
- Hard-coded values still fine for sizes off the token scale (28×28 icon buttons, raw rgba shadows, custom-mixed colors via `color-mix()`).
- 4-space indentation.

#### Path B — Sass functions (legacy fallback)

```scss
@use '../theme-tokens';
@use 'uswds-core' as *;

.blocks-<component-kebab> {
    display: flex;
    padding: units(1.5);
    background: #ffffff;
    color: color('ink');

    &__header {
        padding: units(1) units(1.5);
        background: color('base-lighter');
        border-bottom: 1px solid color('base-light');
        font-size: font-size('body', 'sm');
    }
}
```

**Conventions for Path B:**
- TWO mandatory `@use` statements at the top:
  - `@use '../theme-tokens';` — installs the theme config into the USWDS module graph. **Without it, `color('primary')` returns USWDS-default blue instead of the configured theme value.** Easy to miss because `theme-tokens` doesn't directly export anything the component file references — it's purely side-effect configuration.
  - `@use 'uswds-core' as *;` — makes `color()`, `units()`, `font-size()`, `radius()`, `family()` etc. callable.
- USWDS spacing tokens (`units(N)`) and typography (`font-size('body', ...)`) where they fit.
- `color('ink')` is the high-emphasis text token, NOT `color('base-ink')`. The `'base-ink'` shortcode does not exist in USWDS and raises a Sass error.
- Same BEM nesting rules as Path A.

## MMGIS adapter & tool wrapper templates

### `<Tool>Tool.tsx` (MMGIS tool module, modern pattern)

```tsx
import React from 'react'
import $ from 'jquery'
import { createRoot, type Root } from 'react-dom/client'
import { MMGIS<Tool>Adapter } from './MMGIS<Tool>Adapter'
import { mmgisRequest, mmgisProvide, mmgisEmit } from './adapters/mmgisAPI'

type ToolVars = { /* tool-specific vars from config.json */ }

let _root: Root | null = null

const <Tool>Tool = {
    height: 0,
    width: 320 as number | 'full',
    vars: {} as ToolVars,
    targetId: null as string | null,    // modern pattern
    made: false,                          // modern pattern
    _cleanups: [] as Array<() => void>,

    initialize: async function () {
        // Both 'tool:getVars' and 'app:isMobile' handlers are registered by
        // Layers_.fina() during mission load. In the modern-layout boot path
        // tools can initialize BEFORE Layers_.fina runs, so the requests reject
        // with "[mmgisAPI] No handler". Catch each independently so the tool
        // mounts with declared defaults instead of throwing at startup.
        try {
            this.vars = (await mmgisRequest<ToolVars>('tool:getVars', '<toolname>')) || {}
        } catch (err) {
            console.warn('[<Tool>Tool] tool:getVars unavailable:', err)
        }
        try {
            const isMobile = await mmgisRequest<boolean>('app:isMobile')
            if (isMobile) { this.width = 'full'; this.height = 500 }
        } catch (err) {
            console.warn('[<Tool>Tool] app:isMobile unavailable:', err)
        }
    },

    make: function (targetId?: string) {
        this.targetId = typeof targetId === 'string' ? targetId : 'toolPanel'
        const container = document.getElementById(this.targetId)
        if (!container) {
            console.error(`<Tool>Tool: container ${this.targetId} not found`)
            return
        }
        $(container).css('background', 'var(--color-k)')
        _root = createRoot(container)
        _root.render(<MMGIS<Tool>Adapter />)
        this.made = true
    },

    destroy: function () {
        if (_root) { _root.unmount(); _root = null }
        this._cleanups.forEach((cleanup) => cleanup())
        this._cleanups = []
        this.targetId = null
        this.made = false
    },

    getUrlString: function () { return '' },
}

export default <Tool>Tool
```

**Conventions:**
- `createRoot` from `react-dom/client` (NOT `ReactDOM.render`).
- `targetId` defaults to `'toolPanel'` for classic-UI compatibility.
- Module-level `_root` ref so `destroy()` can unmount.
- `targetId` and `made` are required for the modern tool pattern.

### `MMGIS<Tool>Adapter.tsx` (React component owning state)

```tsx
import React from 'react'
import { useState, useCallback, useEffect } from 'react'
import { <Component> } from './lib'
import type { <DomainType> } from './lib/types'
import { useMMGISEvent } from './adapters/useMMGISEvent'
import { useMMGISToolVars } from './adapters/useMMGISToolVars'
import { get<Tool>Data } from './adapters/get<Tool>Data'
import { /* handlers */ } from './adapters/handlers'

type ToolVars = { /* same shape as in tool wrapper */ }

export function MMGIS<Tool>Adapter() {
    const [data, setData] = useState<<DomainType>[]>([])
    const [loading, setLoading] = useState(true)
    const toolVars = useMMGISToolVars<ToolVars>('<toolname>')

    const refresh = useCallback(async () => {
        try {
            setData(await get<Tool>Data({ /* options from toolVars */ }))
        } catch (err) {
            console.error('<Tool>: refresh failed', err)
            setData([])
        } finally {
            setLoading(false)
        }
    }, [toolVars])

    useMMGISEvent('<event:name>', refresh)
    useEffect(() => { refresh() }, [refresh])

    return (
        <<Component>
            data={data}
            loading={loading}
            onSomething={(id) => { void handlers.someHandler(id) }}
        />
    )
}
```

**Conventions:**
- This is the ONLY file that imports both from `./lib` and from MMGIS-coupled adapters.
- State lives here. `lib/<Component>` is controlled — receives state via props.
- No module-level `state` object exposing setters. The `lib` component must remain framework-agnostic.

### `adapters/` files (boilerplate, mostly mechanical)

The adapter helper files are largely the same shape across tools — cargo-cult them from a previously-refactored tool.

**`adapters/mmgisAPI.ts`** — typed wrappers over `window.mmgisAPI`:

```ts
type EventCleanup = () => void

type MMGISAPI = {
    request: (name: string, params?: unknown) => Promise<unknown>
    on: (event: string, handler: (payload?: unknown) => void) => EventCleanup
    emit: (event: string, payload?: unknown) => void
    provide?: (name: string, handler: (...args: unknown[]) => unknown) => EventCleanup
}

declare global {
    interface Window { mmgisAPI?: MMGISAPI }
}

export const mmgisRequest = async <T = unknown>(name: string, params?: unknown): Promise<T | null> => {
    if (window.mmgisAPI?.request) return (await window.mmgisAPI.request(name, params)) as T
    return null
}

export const mmgisOn = (event: string, handler: (payload?: unknown) => void): EventCleanup => {
    if (!window.mmgisAPI?.on) return () => {}
    return window.mmgisAPI.on(event, handler)
}

export const mmgisEmit = (event: string, payload?: unknown): void => {
    window.mmgisAPI?.emit?.(event, payload)
}

export const mmgisProvide = (name: string, handler: (...args: unknown[]) => unknown): EventCleanup => {
    if (!window.mmgisAPI?.provide) return () => {}
    return window.mmgisAPI.provide(name, handler)
}
```

**`adapters/useMMGISEvent.ts`**:

```ts
import { useEffect } from 'react'
import { mmgisOn } from './mmgisAPI'

export const useMMGISEvent = (
    eventName: string,
    handler: (payload?: unknown) => void,
): void => {
    useEffect(() => {
        const cleanup = mmgisOn(eventName, handler)
        return cleanup
    }, [eventName, handler])
}
```

**`adapters/useMMGISToolVars.ts`**:

```ts
import { useEffect, useState } from 'react'
import { mmgisRequest } from './mmgisAPI'

export const useMMGISToolVars = <T extends Record<string, unknown> = Record<string, unknown>>(
    toolName: string,
): T => {
    const [vars, setVars] = useState<T>({} as T)
    useEffect(() => {
        let cancelled = false
        mmgisRequest<T>('tool:getVars', toolName)
            .then((result) => {
                if (!cancelled && result) setVars(result)
            })
            .catch((err) => {
                // 'tool:getVars' is registered by Layers_.fina() during mission
                // load. If the adapter mounts before that runs, the request
                // rejects. Swallow as warning so we don't propagate an
                // unhandled rejection; component falls back to {} vars.
                if (!cancelled) console.warn(`[useMMGISToolVars] '${toolName}' vars unavailable:`, err)
            })
        return () => { cancelled = true }
    }, [toolName])
    return vars
}
```

**`adapters/build<Tool>Data.ts`** — pure transform from MMGIS-side input shape to the `lib/types` output shape. Pure function, easy to unit-test.

**`adapters/get<Tool>Data.ts`** — orchestrator that calls `mmgisRequest` for each input, applies the transform, returns `<DomainType>[]`.

**`adapters/handlers.ts`** — change handlers, each `async (id, value, [refresh?]) => Promise<void>`. Calls `mmgisRequest` for the mutation, emits the canonical event, optionally awaits `refresh()`.

## `config.json` modern-layout metadata

Each tool's `config.json` MUST include a `metadata` block matching the modern-tool pattern (see `src/essence/Tools/MODERN_TOOL_PATTERN.md` in the MMGIS repo for the canonical reference):

```json
{
    "name": "<Tool>",
    "defaultIcon": "<mdi-icon-name>",
    "toolbarPriority": 2,
    "width": 320,
    "height": 0,
    "paths": {
        "<Tool>Tool": "essence/Tools/<Tool>/<Tool>Tool"
    },
    "expandable": true,
    "metadata": {
        "icon": "<mdi-icon-name>",
        "requiredOrientation": "vertical",
        "compatiblePositions": ["left", "right"],
        "preferredPosition": "left",
        "modernLayoutSupport": true,
        "width": 320,
        "height": 0
    },
    "config": {
        "rows": [ /* admin-UI form for tool variables */ ]
    }
}
```

`requiredOrientation`, `compatiblePositions`, `preferredPosition`, and the width/height in `metadata` drive `DashboardConfigValidator.js`'s placement logic. Choose them per tool's natural shape:
- Vertical panel of items (layer list, etc.) → `requiredOrientation: "vertical"`, `preferredPosition: "left"`, `compatiblePositions: ["left", "right"]`
- Horizontal bar (title, breadcrumbs) → `requiredOrientation: "horizontal"`, `preferredPosition: "top"`, `compatiblePositions: ["top"]`

## Theme tokens

### Path A — no tool-side theme files (recommended)

The tool's `lib/styles/` directory ships **zero theme configuration**. MMGIS's per-theme bundles at `src/styles/<theme>/` own all theme work; the runtime-loaded `dist/<theme>.css` emits `--theme-*` CSS custom properties at `:root` that the tool's component partials consume via `var()`. Skip creating `lib/styles/theme-tokens.scss` entirely.

Default theme MMGIS ships: `disasters`. Others observed: `default`, `earthgov`. Theme selection is driven by `mission.config.msv.theme` (whichever field MMGIS's mission config uses) and switched at runtime in `UserInterfaceModern_.init` or equivalent.

### Path B — local theme-tokens copy (legacy)

Only when pre-flight check 5 (above) reports no `src/styles/<theme>/` infrastructure exists. Copy `<monorepo>/packages/blocks/src/styles/<theme>/theme-tokens.scss` into `<Tool>/lib/styles/theme-tokens.scss`, with these asset-path overrides applied in the `@forward 'uswds-core' with (...)` block (replacing whatever the monorepo's tokens set):

```scss
$theme-image-path: '~@uswds/uswds/img',
$theme-font-path: '~@uswds/uswds/fonts',
$theme-hero-image: '~@uswds/uswds/img/hero.jpg',
```

The `~` prefix is consumed by MMGIS's `resolve-url-loader` + `css-loader` to resolve against `node_modules`. MMGIS doesn't replicate the monorepo's asset-copy build step, so the monorepo's `./img` / `./fonts` paths won't resolve.

**Why copy, not `@forward`?** The monorepo's tokens use `@use 'uswds-core' with (...)` with explicit (non-default) asset paths. Sass `@forward 'X' with (...)` cannot override values that aren't `!default`. To consume the monorepo's tokens directly, an upstream change is needed: expose asset paths as `!default`. Until that lands, copy is the workaround.

## Public exports — `lib/index.ts`

```ts
// Components (one line per public component)
export { <Component1>, type <Component1>Props } from './<Component1>/<Component1>'
export { <Component2>, type <Component2>Props } from './<Component2>/<Component2>'

// Shared domain types
export type { <DomainType1>, <DomainType2> } from './types'

// Side-effect import of compiled styles
import './styles/index.scss'
```

**Conventions:**
- NEVER re-export from `./hooks` or `./utils`. They're internal implementation details.
- Side-effect import at the bottom is what makes the SCSS reachable through the dependency graph. Without it, the styles never compile.
- TypeScript needs an ambient declaration for plain `.scss` imports — `lib/styles/scss-imports.d.ts`:
  ```ts
  declare module '*.scss'
  ```

## `lib/styles/index.scss` and `lib/styles/components-geo/index.scss`

### Path A — components-only manifest

`lib/styles/index.scss`:
```scss
// Theming (USWDS framework + theme tokens + :root --theme-* custom properties)
// is provided by MMGIS's per-theme bundles at dist/<theme>.css, loaded at
// runtime. Component partials reference --theme-* directly.
@forward 'components-geo';
```

### Path B — self-contained theme manifest

`lib/styles/index.scss`:
```scss
@forward 'theme-tokens';
@forward 'uswds';
@forward 'components-geo';
```

### Aggregator (both paths)

`lib/styles/components-geo/index.scss` — pure listing, no theme concerns:
```scss
@use '<component-1-kebab>';
@use '<component-2-kebab>';
// ... one @use per component partial in this directory
```

## Webpack / Sass-loader configuration

The MMGIS webpack config's `sass-loader` `includePaths` must contain:

```js
includePaths: [
    path.resolve(__dirname, "../node_modules/@uswds/uswds/packages"),
    path.resolve(__dirname, "../node_modules"),
],
```

If using Option B for theme tokens (direct monorepo Sass forward), also add:

```js
path.resolve(__dirname, "<relative-path-to-monorepo>/packages/blocks/src/styles"),
```

`sass-loader@8.0.2` (current MMGIS pin) uses the legacy `includePaths` option. Modern sass-loader uses `loadPaths` — verify the loader version before changing the option name.

## Step-by-step procedure

The procedure has two entry points sharing the same core. Pick one based on mode.

### Step 0a: Refactor-mode pre-flight + discovery

1. Run the pre-flight checks from the section above.
2. Read the legacy code. Identify: domain types, sub-components, event subscriptions, action handlers.
3. Plan the BEM block name and sub-element names.

### Step 0b: Greenfield-mode pre-flight + design

1. Run the pre-flight checks.
2. Define the tool's purpose in one paragraph.
3. Sketch the UI — what sub-components compose it? What's the visual hierarchy?
4. Define the data contract — the `<DomainType>` that the `lib/` component receives via props.
5. Define the callback contract — what events does the user trigger?
6. Decide what MMGIS state the tool reflects — which `mmgisAPI` request names provide source data? Which events trigger re-fetch?
7. Decide what MMGIS actions the tool triggers — which `mmgisAPI` request names mutate? Which events to emit afterward?
8. Present the decomposition + domain types + API surface to the user for confirmation before writing code (unless auto-mode is active and spec is clear).

Both modes produce: a sketch of the `lib/` component tree, a domain-types shape, a set of event subscriptions, and a set of handlers.

### Steps 1–14 (shared core)

1. **Create `lib/types.ts`** — exported type aliases. Discriminated unions where rendering branches.
2. **Create `lib/utils/`** — pure-function helpers (refactor: lift legacy `utils/*.js`; greenfield: usually empty initially).
3. **Create `lib/hooks/`** — internal hooks for data fetching, DOM observation, click-outside, etc. NOT the MMGIS event-bus hooks — those live in `adapters/`.
4. **(Path B only) Create `lib/styles/theme-tokens.scss`** — per "Theme tokens" section. Skip for Path A.
5. **Create `lib/styles/index.scss`** — per template above (one line for Path A, three for Path B).
6. **Create `lib/styles/scss-imports.d.ts`** — `declare module '*.scss'`.
7. **Create `lib/styles/components-geo/index.scss`** — aggregator listing every component partial via `@use`.
8. **Author each component, leaf-first** — for each component, create `lib/geo/<Name>/<Name>.tsx` AND `lib/styles/components-geo/<name-kebab>.scss` per templates above. Path A: no `@use` lines in the partial; Path B: two `@use` lines. Dependency order: sub-components before composites. Remember to add the partial to the aggregator in step 7.
8. **Create `lib/index.ts`** — per template above.
9. **Create `adapters/`** — `mmgisAPI.ts`, `useMMGISEvent.ts`, `useMMGISToolVars.ts` are cargo-cult code (see snippets above). `build<Tool>Data.ts`, `get<Tool>Data.ts`, `handlers.ts` are tool-specific.
10. **Create `MMGIS<Tool>Adapter.tsx`** — per template above.
11. **Create `<Tool>Tool.tsx`** — per template above. Replaces legacy `<Tool>Tool.js` in refactor mode.
12. **Create / update `config.json`** — add the `metadata` block per template above.
13. **Refactor-mode only: delete legacy code**:
    ```bash
    git rm -r src/essence/Tools/<Tool>/components/
    git rm -r src/essence/Tools/<Tool>/hooks/
    git rm -r src/essence/Tools/<Tool>/utils/
    git rm src/essence/Tools/<Tool>/<Tool>Tool.css
    git rm src/essence/Tools/<Tool>/<Tool>Tool.js
    ```
14. **Verify**:
    ```bash
    npm run typecheck 2>&1 | tail -5
    npm run build 2>&1 | tail -5
    npm run test:unit 2>&1 | tail -5
    ```

15. **Manual smoke test (deferred to user)** — the skill cannot run a browser. Tell the user to `npm start` and exercise the tool.

### Commit phasing

Don't batch the whole work into one commit. Suggested phases:

1. `feat(<tool>): add lib/types.ts and utils` (Steps 1–2)
2. `feat(<tool>): add lib/hooks` (Step 3)
3. `feat(<tool>): add lib/styles scaffolding` (Steps 4–6)
4. `feat(<tool>): port/author <ComponentName>` — one commit per component (Step 7)
5. `feat(<tool>): add lib/index.ts public exports` (Step 8)
6. `feat(<tool>): add adapters/` (Step 9)
7. `feat(<tool>): add MMGIS<Tool>Adapter` (Step 10)
8. `refactor(<tool>): convert <Tool>Tool to TSX with modern pattern` (Step 11) — refactor mode
   OR `feat(<tool>): add <Tool>Tool TSX with modern pattern` — greenfield mode
9. `feat(<tool>): config.json modern-layout metadata` (Step 12)
10. `refactor(<tool>): remove legacy code` (Step 13) — refactor mode only

Run `npm run typecheck` after each phase. Build is slow; only run it on phase boundaries.

## Hard rules

Apply proactively, not after the build breaks:

1. **`import React from 'react'`** at the top of EVERY `.tsx` file. MMGIS's webpack dev build uses classic JSX runtime; without the import, `npm start` fails (production might pass — easy to miss).

2. **Sass `@use` discipline depends on path:**
   - **Path A (CSS vars):** component partials have **NO** `@use` statements. Reference theme via `var(--theme-color-*, fallback)`. The theme-token bridge in MMGIS's per-theme bundle is responsible for emitting `--theme-*` at `:root`.
   - **Path B (legacy Sass):** every component partial MUST start with TWO `@use` statements in this order:
     ```scss
     @use '../theme-tokens';
     @use 'uswds-core' as *;
     ```
     Without `theme-tokens`, `color('primary')` returns USWDS-default blue.

3. **`color('ink')` not `color('base-ink')`** (Path B only). The high-emphasis ink shortcode is `'ink'`. `'base-ink'` is not valid and raises a Sass error. Path A uses `var(--theme-color-ink, …)` so this isn't applicable.

4. **BEM class naming:** `blocks-<block-name>__<element>--<modifier>`. One block selector per `.scss` file with nested `&__element` and `&--modifier`.

5. **No CSS Modules.** Component styles go in `lib/styles/components-geo/<kebab>.scss` as plain SCSS. TSX references class names as plain strings.

6. **No MMGIS references in `lib/`.** Components must not reference `var(--color-a..l)`, `window.mmgisAPI`, `jQuery`, or `ReactDOM`. Those live in `adapters/` and the tool wrapper.

7. **React 19 = `createRoot`, NOT `ReactDOM.render`.** Stash the root in a module-level `_root` variable so `destroy()` can call `_root.unmount()`.

8. **Modern tool pattern in tool wrapper.** `targetId`, `made`, `metadata` block in `config.json`. Default `targetId` to `'toolPanel'` for classic-UI compat.

9. **State lives in the MMGIS adapter component, not in module globals.** Legacy `state = { setLayers, setLoading }` patterns (setters leaked from React via `useEffect`) are forbidden. The adapter owns state; the `lib/` component is controlled.

10. **`npm install --force`, never `--legacy-peer-deps`.** In MMGIS's dep tree, `--legacy-peer-deps` strips required transitive packages (`@deck.gl/extensions`, `@deck.gl/mesh-layers`, `focus-trap-react`, `bluebird`). `--force` keeps them.

11. **No `Co-Authored-By: Claude` trailers in any commit message.** This is an absolute project preference.

## Gotchas

Beyond the hard rules, watch for these:

### Sass

- **`@forward` cannot be nested inside a selector.** Sass syntax error. Either rely on the global theme CSS approach OR use `postcss-prefix-selector` at the post-Sass step.
- **`@use ... with (...)` values lock.** Once `uswds-core` is configured by one file, downstream `@forward 'X' with (...)` cannot override values the upstream set explicitly (only `!default` values are overridable). Plan accordingly when consuming monorepo tokens directly.

### React / JSX

- **`useRef()` in React 19 requires an explicit initial value or generic.** `useRef<T>(null)`, not bare `useRef()`.
- **`ReactDOM.render` is removed.** Always use `createRoot`.

### npm install

- **`--legacy-peer-deps` is destructive** in MMGIS — drops `@deck.gl/extensions`, `@deck.gl/mesh-layers`, `focus-trap-react`, `bluebird`. Use `--force`.
- **The lockfile may diverge cosmetically.** `--force` install often brings back the legacy v1-style `dependencies` mirror section. Big diff size; no functional change.

### Common pre-existing issues (don't try to fix in this skill's scope)

When refactoring on a recently-merged `fork/development`, expect these and DO NOT try to fix them:
- `PDFViewer.js` stray `: { numPages: number }` type annotation (Babel tolerates, TS rejects when transitively imported)
- `src/external/georaster-layer-for-leaflet/*.ts` type errors when transitively imported
- `Formulae_.js:978` `keyArray === []` always-false comparison
- `tests/unit/panelManager/*.spec.js` `window is not defined` (Node-side imports load Leaflet code at module scope)
- `bluebird` sometimes missing from `node_modules` despite `require('bluebird')` in `API/database.js`

Surface these as "pre-existing" and proceed.

## Verification & output

After all phases, run:

```bash
npm run typecheck 2>&1 | tail -5
npm run build 2>&1 | tail -5
npm run test:unit 2>&1 | tail -5
```

For each, distinguish:
- New errors caused by this skill's work → must fix before reporting done
- Pre-existing errors → flag and proceed

Report back to the user in this format:

```
<Tool> <refactored | built> to monorepo pattern.

**Files:**
- lib/: N components, M utils, K hooks, X.scss files
- adapters/: 6 files (mmgisAPI, useMMGISEvent, useMMGISToolVars, build<X>Data, get<X>Data, handlers)
- MMGIS<Tool>Adapter.tsx, <Tool>Tool.tsx, config.json

**Commits:** <count>, range <SHA1>..<SHAN>

**Gates:**
- typecheck: <clean | N pre-existing errors elsewhere>
- build: <succeeded | failed with X>
- test:unit: <N/N passed | F failed>

**Outstanding:**
- Manual UI smoke test (browser) — user to verify the tool renders and event-bus actions work.
- Any pre-existing fork/development issues that surfaced (not introduced).

**For extraction to monorepo:** the lib/ directory is portable. `git mv src/essence/Tools/<Tool>/lib/ <monorepo>/packages/blocks/src/geo/<Tool>/` to move.
```

## Idempotency (refactor mode)

If invoked on a target that's already partly refactored:

- Check for existing `lib/`, `adapters/`, BEM class names in TSX, `metadata` block in config.json.
- Skip steps whose outputs already exist and match the expected shape.
- Report which steps were skipped.
- If existing files DON'T match the pattern (e.g., legacy `.module.scss` left behind from an earlier attempted refactor), prompt the user before overwriting.

## Destructive-awareness (greenfield mode)

- Refuse to overwrite a target directory that already has source files. Surface the conflict; ask the user to pick a different name or explicitly confirm overwriting.
- Empty or non-existent target directories are fine — create them.

## Skill scope boundaries — do NOT do

- Do NOT modify MMGIS-wide infrastructure (`webpack.config.js`, `package.json` deps, `tsconfig.json`) unless the pre-flight check fails AND the user explicitly authorizes. Setup belongs in a separate effort.
- Do NOT touch `src/external/` — those are vendored libraries.
- Do NOT touch other tools or the configure UI — scope is the target tool only.
- Do NOT migrate React versions — assume React 19 is already in place. If pre-flight finds React 16, stop and flag.
- Do NOT install/uninstall packages unless absolutely required AND user-confirmed.

## Reference: CardDetailed as canonical example

The monorepo's CardDetailed component is the canonical example of the BEM + `blocks-` pattern. When in doubt about naming, file layout, or Sass nesting, compare with:

- `<monorepo>/packages/blocks/src/components/Cards/CardDetailed/CardDetailed.tsx`
- `<monorepo>/packages/blocks/src/styles/components/card-detailed.scss`

Block name: `blocks-card-detailed`. Elements: `__title`, `__image-wrapper`, `__content`, `__accent-bar`, etc. Modifiers: `--image-bottom`, `--image-cover`.
