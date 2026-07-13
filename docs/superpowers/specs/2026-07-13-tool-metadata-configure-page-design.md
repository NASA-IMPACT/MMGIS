# Tool Metadata in the Configure → Tools Page — Design

**Date:** 2026-07-13
**Status:** Approved (design)
**Branch:** `fix/tool-metadata-mission-config`

## Why

The modern layout system places tools into panels based on a per-tool
**metadata** object (`modernLayoutSupport`, `requiredOrientation`,
`compatiblePositions`, `preferredPosition`, `width`, `height`, and behavior
flags). At runtime this metadata is read directly from each mission-config tool
entry:

```
modern.js → assignToolsToPanels(configData.tools)
          → buildToolConfigMap() → generateToolMetadata(toolConfig)   // reads toolConfig.metadata
```

Today there is **no way to set that metadata from the Configure page**. Only
three tools (Card, LayerManager, Title) declare a `metadata` block, and they do
so by hand-editing config/mission JSON. Every other tool defaults to generic
values (orientation `any`, `modernLayoutSupport` falsy), so a non-coder cannot
make a tool participate in the modern layout without editing raw JSON.

This work exposes tool metadata in the Configure → Tools page so that, for every
tool, the metadata is **available** (declared with sensible defaults) and
**editable**, and edits are **stored in the mission config JSON** at
`configuration.tools[i].metadata` — exactly where the modern layout already
reads it.

## Scope

- **In scope:** Configure-page editing UI + storage for tool metadata; seeding
  per-tool default metadata; the field set the modern layout needs.
- **Out of scope / no change required:** the runtime/modern layout. It already
  reads `configuration.tools[i].metadata` via `generateToolMetadata`, so once
  the Configure page writes metadata there it works with no runtime changes.
- **Excluded tool:** `Kinds` (a pseudo-tool already skipped on the Tools page).

## How it works today (facts the design relies on)

- Each tool has `src/essence/Tools/<Tool>/config.json`. `API/updateTools.js`
  aggregates these into `configure/public/toolConfigs.json`, which the Configure
  → Tools page (`configure/src/components/Tabs/Tools/Tools.js`) fetches to render
  tool cards and the `ToolModal`.
- `ToolModal` renders the tool's `config` through the shared `Maker`
  (`configure/src/core/Maker.js`) and, on close, bakes scalar component defaults
  into the active tool entry (`handleClose`).
- `Maker` already supports every widget needed: `dropdown`, `multiselect` (with
  nested-field-path support), `switch`, and `number`.
- Nested field paths work end to end: a component with `field: "metadata.<x>"`
  reads via `getIn(tool, "metadata.<x>")` and writes via
  `updateToolInConfiguration → setIn(tool, ["metadata","<x>"], value, force=true)`,
  which force-creates the `metadata` object.
- **No tool uses `config.tabs`.** All tools use `config.rows` or have no
  `config` at all (Chart, Chemistry, FetchStats, Kinds). So a metadata section
  can live uniformly in `config.rows`; the "no config" tools (except Kinds) get a
  `config.rows` added.

## Data model

All fields are stored under the tool entry's `metadata` object in the mission
config, i.e. `configuration.tools[i].metadata.<field>`.

| Field | Widget (`Maker` type) | Options / range |
|---|---|---|
| `modernLayoutSupport` | `switch` | boolean |
| `requiredOrientation` | `dropdown` | `any`, `horizontal`, `vertical` |
| `compatiblePositions` | `multiselect` | `top`, `left`, `right`, `bottom`, `float-top-left`, `float-top-center`, `float-top-right`, `float-bottom-left`, `float-bottom-center`, `float-bottom-right` |
| `preferredPosition` | `dropdown` | same position list as `compatiblePositions` |
| `width` | `number` | 100–2000 |
| `height` | `number` | 0–2000 |
| `separatedTool` | `switch` | boolean |
| `expandable` | `switch` | boolean |
| `startHidden` | `switch` | boolean |
| `startUnloaded` | `switch` | boolean |

The position option lists mirror `PANEL_POSITION` in
`src/essence/Basics/PanelManager_/types/layout.ts`. `requiredOrientation` values
mirror `TOOL_ORIENTATION` in
`src/essence/Basics/ToolController_/types/tool.ts`. These lists are duplicated
into the config generator (see below); if the enums change, the generator's
lists must be updated to match. This is called out so the coupling is explicit.

The metadata schema is already validated/sanitized at runtime by
`ToolMetadataUtils.js` (`validateToolMetadata`, `sanitizeToolMetadata`), so
malformed values written from the Configure page are defended against on read.

## Component 1 — Per-tool config.json changes

Each tool's `config.json` (except `Kinds`) gets two additions:

1. **A `metadata` block** holding sensible per-tool default values (the
   "available" defaults). The three existing modern tools (Card, LayerManager,
   Title) keep their current `metadata` blocks unchanged.
2. **A standardized "Modern Layout" row section** appended to `config.rows`: a
   `subname` header row followed by the ten metadata components from the table
   above, each with `field: "metadata.<x>"`. Each component's default
   (`defaultChecked` for switches, `default`/first option for dropdowns, `default`
   for numbers) **mirrors that tool's `metadata` block**, so the block and the
   editor never disagree.

Tools with no `config` (Chart, Chemistry, FetchStats) get a minimal
`config: { rows: [ <metadata section> ] }`.

### Default policy for legacy (non-modern) tools

- `modernLayoutSupport: false`
- `requiredOrientation: "any"`
- `compatiblePositions: ["top", "left", "right", "bottom"]`
- `preferredPosition: "left"`
- `width`: the tool's existing top-level `width` if present, else `300`
- `height`: the tool's existing top-level `height` if present, else `0`
- `separatedTool`, `expandable`, `startHidden`, `startUnloaded`: `false`

These are starting points a configurer can override per mission. The three
modern tools retain their richer, already-correct values.

### Generator script (recommended mechanism)

Because the same ~10-field section repeats across ~16 tools, an **idempotent
Node script** (e.g. `scripts/seed-tool-metadata.js`, run manually and
re-runnable) injects the canonical "Modern Layout" section + `metadata` block
into each `config.json` from a single per-tool defaults table. This keeps one
source of truth and avoids hand-editing drift, while still producing plain
per-tool `config.json` rows. The script must:

- Be idempotent: re-running replaces the managed metadata section/block rather
  than appending duplicates (e.g. mark the row with a stable `subname` /
  sentinel key it can find and overwrite).
- Skip `Kinds`.
- Preserve existing `metadata` blocks for Card, LayerManager, Title (only inject
  where a value is absent, or leave listed tools untouched).
- Preserve each file's existing `config.rows` content, appending the metadata
  section after the tool's own rows.

After running the generator, `API/updateTools.js` regenerates
`configure/public/toolConfigs.json` on the next server start (dev hot-reload), so
the Configure page picks up the new sections without a manual build.

## Component 2 — ToolModal seeding & save

The existing `ToolModal` + `Maker` path already renders `config.rows` and writes
edits into the mission config. Two refinements:

- **Seeding (`ToolModal`):** when the modal opens for an **active** tool and a
  `metadata.<x>` value is unset, seed it from that tool's `metadata` block (from
  `toolConfig.metadata` in `toolConfigs.json`) so the editor shows the tool's
  real defaults and they persist into the mission config. This specifically
  covers `compatiblePositions` (a `multiselect`), whose default the current
  `handleClose` scalar-baking does not set.
- **Save:** unchanged. `Maker`'s `updateToolInConfiguration` force-creates
  `tool.metadata` and writes each field; `handleClose` continues to bake scalar
  defaults for active tools.

Metadata is only persisted for **active** tools (a tool present in
`configuration.tools`), consistent with existing `ToolModal`/`handleClose`
behavior. Toggling a tool on adds its entry; the metadata section then applies.

## Data flow

```
config.json (metadata block + config.rows metadata section)
   │  API/updateTools.js
   ▼
configure/public/toolConfigs.json
   │  Configure → Tools → ToolModal → Maker
   ▼
configuration.tools[i].metadata.*   (mission config JSON, saved via Configure)
   │  modern.js → assignToolsToPanels → generateToolMetadata
   ▼
Modern layout panel placement (validated/sanitized by ToolMetadataUtils)
```

## Testing

- **Generator:** unit test that running it on a fixture `config.json` produces
  the expected `metadata` block + metadata `config.rows` section, and that
  re-running is idempotent (no duplicate sections) and preserves existing rows
  and the three modern tools' blocks.
- **Configure UI (manual / component):** open `ToolModal` for a legacy tool →
  the Modern Layout section renders with seeded defaults; edit a dropdown, a
  switch, `compatiblePositions`, and `width` → values are written to
  `configuration.tools[i].metadata`; reopen → edited values persist.
- **Round-trip:** a tool configured with `modernLayoutSupport: true` and a
  `preferredPosition` is placed by the modern layout into the expected panel
  (existing `ToolMetadataUtils`/modern-layout behavior; no new runtime code).
- **Regression:** Card, LayerManager, Title metadata unchanged and still place
  correctly.

## Risks / notes

- **Enum drift:** the generator duplicates the `PANEL_POSITION` /
  `TOOL_ORIENTATION` value lists. If those enums change, update the generator.
  (Called out explicitly rather than trying to import TS enums into the config
  files, which are static JSON.)
- **Redundant defaults:** the `metadata` block and the metadata component
  defaults both hold the same values. The generator produces both from one table,
  so they stay consistent; do not hand-edit one without the other.
- **Active-only persistence:** metadata for a tool that is toggled off is not
  written to the mission config — matching current behavior. This is acceptable
  because the modern layout only considers tools in `configuration.tools`.
