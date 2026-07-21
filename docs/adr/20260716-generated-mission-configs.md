# Generated Mission Configs

- **Status**: Approved
- **Date**: 2026-07-16
- **Deciders**: MMGIS Core Team
- **Tags**: mission-config, generator, deployment, seed, tooling

---

## Executive Summary

Mission configs that ship with the repo are **generated, never hand-edited**. A single
generator composes two hand-maintained inputs — per-tool `defaults` blocks and a curated
profile — into a complete mission config. CI regenerates every profile on each PR and fails
if a committed artifact is stale, so the shipped configs can no longer silently drift when a
tool changes.

Two profiles ship today:

- **full-demo** — the everything-on showcase mission (local dev deployments boot from it via
  the deployment tooling's template database; PR previews will publish it — #156. The deployed
  dev environment keeps its own persistent database and does not reseed from it).
- **minimal** — a two-tool starting point for brand-new missions (wired into the new-mission
  template by #109).

---

## Context

The seed mission was a single hand-maintained JSON file. Adding a tool meant remembering to
hand-edit the seed; forgetting left the new tool invisible everywhere the seed is consumed.
There was no enforcement, and the file drifted from the actual set of tools in the tree.

The fix is to make the seed (and any other shipped mission config) a build artifact derived
from inputs that live next to the things they describe.

---

## Decision: a two-layer model

### Layer 1 — per-tool `defaults` (in the manifest)

Each tool's `src/essence/Tools/<Name>/config.json` manifest declares a `defaults` block:

```json
{
  "name": "Legend",
  "defaults": {
    "variables": { "displayOnStart": false, "justification": "left", "showHeadersInLegend": false }
  },
  ...
}
```

`defaults.variables` holds the tool's default configuration values, derived from the tool's
Configure schema (checkbox `defaultChecked`, dropdown `options[0]`, documented text defaults).
Data-shaped fields — layer-specific object/text arrays, free-form ids — are intentionally left
out; a mission supplies those through a profile override when it needs them.

**Declaring `defaults` is how a tool opts into generation.** A manifest with no `defaults`
block never appears in a generated config. Two additional flags:

- A profile's `exclude` list opts tools out of its implicit everything-on (`"all"`) set.
  Exclusion is profile policy, never manifest knowledge. The full-demo profile excludes the
  13 classic-era tools (Animation, Chemistry, Curtain, Draw, Identifier, Info, Isochrone,
  Layers, Legend, Measure, Shade, Sites, Viewshed), keeping the showcase to the modern plugin
  set. Those tools also declare no `defaults` block — absence keeps them out mechanically;
  the exclude list documents the intent explicitly.

### Layer 2 — profiles (curated policy files)

A profile (`mission-profiles/<name>.json`) owns everything the tool manifests cannot describe:

| Field | Meaning |
|-------|---------|
| `tools` | `"all"` (every manifest with `defaults`, minus the profile's `exclude` list) or an explicit array of tool names. |
| `on` | Array of tool names that start toggled on. |
| `exclude` | (with `"all"`) tool names to omit despite their `defaults` block. |
| `overrides` | `{ <ToolName>: { variables: {...} } }` — per-tool variable overrides, deep-merged onto the manifest defaults (objects merge; arrays and scalars replace). |
| `scaffold` | The non-tool config: `msv`, `projection`, `look`, `panelSettings`, `panels`, `time`, `layers`. |
| `output` | Repo-root-relative path of the generated artifact. |

Environment-specific secrets are never committed: the basemap token lives in the scaffold as
the `{{MAPBOX_TOKEN}}` placeholder and is substituted at deploy time.

---

## The generator

`scripts/generate-mission-config.js` composes manifests + a profile into a full mission config.

```
node scripts/generate-mission-config.js <profile> [--out <path>] [--stdout] [--check]
```

What it does:

1. Scans **only the tracked** `src/essence/Tools/<Name>/config.json` manifests. It never parses
   `src/pre/tools.js`, and never the `*Plugin-Tools*` / `*Private-Tools*` dirs that
   `API/updateTools.js` also globs — untracked local tools must not influence committed output.
   `Kinds` is hard-skipped (a core module, never a mission tool; it declares no `defaults`).
2. Selects tools per the profile's `tools` policy.
3. Builds each tool entry with a fixed key order:
   `{ name, icon, js, on, variables, metadata }`.
   - `icon` = the manifest's `defaultIcon`, omitted when absent (`FetchStats`).
   - `js` = the first key of the manifest's `paths`.
   - `variables` = manifest `defaults.variables` deep-merged with the profile override.
   - `metadata` = the manifest's `metadata` block, copied **verbatim** when present.
4. Sorts tools by `toolbarPriority || 1000`, then by name (real priority ties exist).
5. Assembles the config in the canonical top-level key order and writes it with **LF** line
   endings, 2-space indent, and placeholders left verbatim.

**Determinism** is a hard requirement: running the generator twice produces byte-identical
output. Stable sort, fixed key order, LF endings, and never minting values at generation time
guarantee it.

### Why `metadata` is copied into every entry

The modern runtime reads a tool's **placement** metadata (orientation, compatible/preferred
positions) only from the mission-config tool entry —
`ToolMetadataUtils.generateToolMetadata(toolConfig)` reads `toolConfig.metadata` — **never**
from the manifest at runtime. If the generator omitted `metadata`, any tool the scaffold does
not explicitly place via `panelTools` would pile into the first panel. Copying the manifest's
`metadata` verbatim into each generated entry is therefore load-bearing, not cosmetic.

### Validation vs. what we write

The generator validates a **deep clone** of the composed config with the backend validator
(`API/Backend/Config/validate.js`), which passes placeholders and `time.initialend: "now"`. It
validates a clone because `validate()` mutates its input (it injects layer defaults). The **raw**
composition is what gets written.

### Template-superset assertion

The generator asserts the output is a **recursive key-superset** of
`API/templates/config_template.js`: every template key must be present, recursing wherever both
sides are plain objects (arrays replace wholesale and posted scalars win under the merge, so for
non-objects the key's presence suffices). This matters because the mission create path (`add()`)
deep-merges a posted config over the template as fallback — per the template-merge fix (#194),
posted arrays **replace** template arrays instead of concatenating, but object keys still
gap-fill recursively. Ensuring the generated config already carries every template key, nested
ones included, means the gap-fill adds nothing, so the committed artifact equals the seeded
mission exactly. (`add()` never runs `populateUUIDs`/`validate` — those are upsert-only — which
is also why layer UUIDs must be authored constants in the profile, never minted at generation
time; otherwise the CI diff would flap.)

---

## Artifacts and consumers

| Artifact | Generated from | Consumed by |
|----------|----------------|-------------|
| `mission-profiles/generated/full-demo-mission.json` | `mission-profiles/full-demo.json` | The local deployment tooling (`.claude/skills/mmgis-deployment`) seeds the template database from it; PR previews (#156) will publish it. |
| `API/templates/config_template.json` | `mission-profiles/minimal.json` | The new-mission template (#109 wires it into `config_template.js`). |

Both artifacts are committed. Both are regenerated and diff-checked in CI.

---

## CI check

`.github/workflows/playwright-tests.yml` gains a `config-generation` job: it regenerates both
profiles and runs `git diff --exit-code` on the two committed artifacts. A stale commit fails
the PR with the exact regeneration commands. The regenerated diff **is** the review artifact.

In-flight tool branches (e.g. Timeline, LayerFilter/Themes, Comparison, AddTempLayer) each join
the full-demo config at merge only once they ship a `defaults` block — a checklist line for
those PRs.

---

## How-tos

**Add a tool to the full-demo.** Declare a `defaults` block in the tool's manifest (and a
`metadata` block if it needs specific placement), then regenerate:
`node scripts/generate-mission-config.js full-demo`. With `tools: "all"`, the tool appears in
the generated config with no profile edits. Commit the manifest change and the regenerated
artifact.

**Change the full-demo** (which tools are on, layout, layers, demo cards, time). Edit
`mission-profiles/full-demo.json`, regenerate, commit. Never hand-edit
`mission-profiles/generated/full-demo-mission.json`.

**Keep a tool out of the everything-on config.** Add its name to the full-demo profile's `exclude` list.

**Start a brand-new profile.** Copy an existing profile, set `tools`, `on`, `overrides`,
`scaffold`, and `output`, then `node scripts/generate-mission-config.js <name> --out <path>`.

---

## Special cases (acknowledged plainly)

- **Kinds** is a core module, not a mission tool. It is hard-skipped by the generator and gets
  no `defaults` block.
- **The 13 classic-era tools** carry no `defaults` block and are additionally named on the
  full-demo `exclude` list (see Layer 1). **Draw**, among them, is the only tool the backend
  drops in lean deployments, so no separate lean profile variant is needed — the exclusion
  keeps it out of the generated config entirely.
- **`add()` / `config_template` divergence from upstream is accepted.** The template-merge
  fallback-only semantics (#194) and the generated minimal template (#109) intentionally differ
  from upstream MMGIS behavior; that divergence is a deliberate part of this project's direction.

---

## Consequences

**Positive**

- The shipped configs can no longer silently drift; a new tool with defaults shows up automatically.
- CI enforces committed == regenerated, making stale configs a hard failure, not a latent bug.
- Profiles cleanly separate curated policy (layout, layers, on-state) from mechanical tool
  defaults, and the profile mechanism already supports future preset profiles (predefined
  layout + tool combos) with no new machinery.

**Negative / trade-offs**

- Tool authors must remember to declare `defaults` (enforced socially + by the CI checklist for
  in-flight branches, not by a build failure — a tool with no defaults is simply absent).
- The generated artifacts are committed, so every profile/tool change carries a regenerated diff.
