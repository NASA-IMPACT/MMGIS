# MMGIS Review-Wisdom Corpus

> **DRAFT — human review required.** Auto-generated from the PR-review history of
> `NASA-IMPACT/MMGIS` by the `learn-from-pr-reviews` skill. Each lesson traces to a
> real comment via its URL; verify against the live thread before relying on it.

## Totals

- **Threads analyzed:** 151 (across 67 PRs — merged, closed, open)
- **Substantive:** 115  •  **Discarded as nits/logistics/chit-chat:** 36 (not dropped silently — see note)
- **Confidence (substantive):** high 92, low 11, med 12
- **Code-context coverage (substantive):** full 108, none 7
- **Verdict model:** Claude Sonnet (hardened phase-3 prompt: `resolved=true` ⇒ never "ignored"; ambiguous delta ⇒ "unclear")

*Verdict legend:* ✅ addressed · 🔵 acknowledged-no-change · ⚠️ ignored · ❔ unclear · ⛔ rejected

---

## craftsmanship (76)

_Verdict mix: 

- 🔵 **acknowledged-no-change/high** — When adding infrastructure-hardening code that fixes a latent issue triggered only by specific deployment topologies (e.g., proxy/load-balancer idle-connection teardown), document in the code comment which topology triggers the problem and why it was safe to omit previously — not just what the code does.  
  ([PR#135](https://github.com/NASA-IMPACT/MMGIS/pull/135#discussion_r3391729153))
- 🔵 **acknowledged-no-change/high** — When rendering items from a metadata object, use the available metadata fields (e.g., icon, label) rather than hardcoding placeholder values — hardcoded fallbacks mask missing data and become tech debt when real metadata is available.  
  ([PR#57](https://github.com/NASA-IMPACT/MMGIS/pull/57#discussion_r3191276754))
- 🔵 **acknowledged-no-change/med** — When adding multiple new type variants to a switch/dispatch, give each variant its own meaningful icon and color rather than falling through to a single shared default — collapsing distinct types into one visual bucket obscures semantic differences that users rely on.  
  ([PR#62](https://github.com/NASA-IMPACT/MMGIS/pull/62#discussion_r3066419019))
- 🔵 **acknowledged-no-change/high** — When a destroy/cleanup function removes a runtime instance, verify it also cleans up any registries or managers that track that instance (e.g., panel managers, event buses, routing tables) — if intentionally omitted, document why and identify where the corresponding deregistration belongs.  
  ([PR#80](https://github.com/NASA-IMPACT/MMGIS/pull/80#discussion_r3203799256))
- 🔵 **acknowledged-no-change/high** — Avoid `npm install --force` in Dockerfiles or CI; prefer resolving peer dependency conflicts by updating package versions to compatible ranges. If --force is unavoidable, add an inline comment documenting the exact conflict and link to a tracking issue so it doesn't silently persist.  
  ([PR#85](https://github.com/NASA-IMPACT/MMGIS/pull/85#discussion_r3277400874))
- ✅ **addressed/high** — When adding a utility/adapter that wraps a shared API (e.g., a global window object), place it in a shared/common folder accessible to all plugins rather than nesting it under a specific plugin's directory, to prevent duplication as other plugins inevitably need the same abstraction.  
  ([PR#111](https://github.com/NASA-IMPACT/MMGIS/pull/111#discussion_r3351227435))
- ✅ **addressed/high** — When a hook or utility is generic enough to work across multiple plugins/modules, place it in a shared directory (e.g., _shared/ or common/) rather than inside a single plugin's folder, to avoid duplication and signal reusability.  
  ([PR#111](https://github.com/NASA-IMPACT/MMGIS/pull/111#discussion_r3351232858))
- ✅ **addressed/high** — Use generic, domain-neutral directory names (e.g., "components") rather than domain-qualified names (e.g., "components-geo") unless the qualifier adds necessary disambiguation; unnecessary qualifiers add noise and diverge from established conventions.  
  ([PR#111](https://github.com/NASA-IMPACT/MMGIS/pull/111#discussion_r3351264122))
- ✅ **addressed/high** — Routes that shell out to external runtimes (Python, GDAL, etc.) or access environment-specific resources must be guarded by a deployment-mode check; registering such routes unconditionally allows them to be called in environments where the dependency does not exist.  
  ([PR#133](https://github.com/NASA-IMPACT/MMGIS/pull/133#discussion_r3391052596))
- ✅ **addressed/high** — Avoid hardcoding per-component, per-mode checks in a shared rendering engine. Instead, have components declare their requirements (e.g., a `requiresCapability` field) and let the engine evaluate them generically — new gating is then a one-line config change, not a code change.  
  ([PR#134](https://github.com/NASA-IMPACT/MMGIS/pull/134#discussion_r3391079811))
- ✅ **addressed/high** — When a configuration schema allows multiple components to occupy the same slot or position, the design doc must explicitly specify the conflict-resolution semantics (priority ordering, validation, fallback behavior) before implementation begins — ambiguity here becomes a runtime surprise.  
  ([PR#23](https://github.com/NASA-IMPACT/MMGIS/pull/23#discussion_r2815959259))
- ✅ **addressed/high** — Do not mix raw external config fields with normalized domain fields in the same interface; define a separate type for the raw external shape and a distinct type for the internal domain model, bridging them with an explicit adapter or translation layer.  
  ([PR#33](https://github.com/NASA-IMPACT/MMGIS/pull/33#discussion_r2881499091))
- ✅ **addressed/high** — When generating a fixed-length array (e.g., resolution levels, tick counts) with a hardcoded upper bound, derive that bound from a relevant configuration parameter (such as maxZoom or a dedicated maxResolutionLevels option) with the magic number only as a fallback default.  
  ([PR#33](https://github.com/NASA-IMPACT/MMGIS/pull/33#discussion_r2881502681))
- ✅ **addressed/high** — Remove inline comments that merely restate what the next line of code does (e.g., "// Store for cleanup" before a Map.set call); only keep comments that explain the non-obvious "why", not the self-evident "what".  
  ([PR#33](https://github.com/NASA-IMPACT/MMGIS/pull/33#discussion_r2881506375))
- ✅ **addressed/high** — Remove inline comments that merely restate what self-evident code already expresses (e.g., "// Get the container element" before getElementById); comments should explain *why*, not narrate *what*.  
  ([PR#33](https://github.com/NASA-IMPACT/MMGIS/pull/33#discussion_r2881506488))
- ✅ **addressed/high** — Do not call expensive layout/render invalidation methods (e.g. invalidateSize, reflow triggers) inside high-frequency view-update routines (pan, zoom, setView) unless the container dimensions have actually changed; scope such calls to resize events only.  
  ([PR#33](https://github.com/NASA-IMPACT/MMGIS/pull/33#discussion_r2881521570))
- ✅ **addressed/high** — Remove inline comments that merely narrate what the code is doing (e.g., "// Create the map", "// Get the container element") — they add visual noise without conveying intent, rationale, or non-obvious behavior.  
  ([PR#33](https://github.com/NASA-IMPACT/MMGIS/pull/33#discussion_r2881522395))
- ✅ **addressed/high** — Before adding a type variant (especially a "full" or "all" option), confirm it is actually needed and safe — an unconstrained size option can cause destructive UI effects (e.g., blocking the primary content area) and should be removed if no real use case justifies it.  
  ([PR#35](https://github.com/NASA-IMPACT/MMGIS/pull/35#discussion_r2849540972))
- ✅ **addressed/high** — Avoid generic method names like `toggle`, `update`, or `handle` — name functions after exactly what they act on and what they do (e.g., `togglePanelCollapsed` instead of `toggle`) so callers never need to read the implementation to understand the effect.  
  ([PR#35](https://github.com/NASA-IMPACT/MMGIS/pull/35#discussion_r2880269053))
- ✅ **addressed/high** — Plugin/extension APIs should auto-generate namespace prefixes from the plugin's own identity, rather than letting callers supply arbitrary prefixes, so one plugin cannot accidentally or maliciously register handlers under another plugin's namespace.  
  ([PR#36](https://github.com/NASA-IMPACT/MMGIS/pull/36#discussion_r2880361242))
- ✅ **addressed/high** — Avoid nested conditionals where the inner check is redundant given the outer condition; flatten guard clauses so each validation is a direct, unconditional check at the top of the function.  
  ([PR#47](https://github.com/NASA-IMPACT/MMGIS/pull/47#discussion_r3024609371))
- ✅ **addressed/high** — When a method sets a field that has multiple consumers (e.g., activeToolId used for both iconified-panel focusing and tabbed-layout active tab), ensure the method's name, JSDoc, and guarding logic reflect the full set of valid states — not just the originally-conceived use case — so callers and reviewers can understand the contract without reading downstream consumers.  
  ([PR#47](https://github.com/NASA-IMPACT/MMGIS/pull/47#discussion_r3024652778))
- ✅ **addressed/high** — When a function documents a precondition (e.g., @throws if not in X state), verify that the implementation actually enforces it — overly complex conditional logic can silently let invalid states through while the docstring claims otherwise.  
  ([PR#47](https://github.com/NASA-IMPACT/MMGIS/pull/47#discussion_r3024658822))
- ✅ **addressed/high** — When a method's docstring or comment describes restoring a previously-held state (e.g. "last visible state", "previous mode"), verify that the implementation actually persists that state; if no field tracks it, either add the field or correct the documentation to match what really happens.  
  ([PR#47](https://github.com/NASA-IMPACT/MMGIS/pull/47#discussion_r3024673976))
- ✅ **addressed/high** — When a state-machine operation cannot be performed due to constraint violations, fail loudly with a descriptive error rather than silently returning — silent no-ops hide bugs and make callers impossible to trust.  
  ([PR#47](https://github.com/NASA-IMPACT/MMGIS/pull/47#discussion_r3024683451))
- ✅ **addressed/high** — Name methods to reflect what they actually do: a function that only dispatches an event should be called notifyX or emitX, not recalculateX or updateX, so callers are not misled about side effects or computation.  
  ([PR#47](https://github.com/NASA-IMPACT/MMGIS/pull/47#discussion_r3028682774))
- ✅ **addressed/high** — Name functions for what they actually do: if a function only fires a notification event rather than performing computation, its name should reflect that (e.g., notifyLayoutChanged, not recalculateLayout), so callers are not confused about whether side effects are intentional.  
  ([PR#47](https://github.com/NASA-IMPACT/MMGIS/pull/47#discussion_r3028686801))
- ✅ **addressed/high** — When a manager/registry class exposes an `add*` or `register*` method, always also provide the symmetric `remove*`/`unregister*` counterpart — even if no caller needs it yet — so the API supports the full object lifecycle and avoids forcing callers into workarounds later.  
  ([PR#47](https://github.com/NASA-IMPACT/MMGIS/pull/47#discussion_r3028689812))
- ✅ **addressed/high** — When registering or initializing an entity with a configuration that includes a default value drawn from a constrained set, validate at registration time that the default is a member of the allowed set and throw a descriptive error if not.  
  ([PR#47](https://github.com/NASA-IMPACT/MMGIS/pull/47#discussion_r3028794568))
- ✅ **addressed/high** — When a class exposes a registration or add operation (registerPanel, addItem, subscribe), always provide a symmetric inverse (unregisterPanel, removeItem, unsubscribe) to avoid resource leaks and allow proper lifecycle management.  
  ([PR#47](https://github.com/NASA-IMPACT/MMGIS/pull/47#discussion_r3028797475))
- ✅ **addressed/high** — When a CSS class or identifier name is borrowed from a narrower original use and applied more broadly, rename it to reflect its actual scope before the PR lands — stale names mislead future readers about what the style applies to.  
  ([PR#57](https://github.com/NASA-IMPACT/MMGIS/pull/57#discussion_r3028714637))
- ✅ **addressed/high** — CSS custom properties declared under :root in an embeddable library leak into the host page's global scope; prefix all CSS variables with a library-unique namespace (e.g., --mylib-) to avoid collisions.  
  ([PR#57](https://github.com/NASA-IMPACT/MMGIS/pull/57#discussion_r3191231321))
- ✅ **addressed/med** — When merging placeholder or stub implementations, either annotate every incomplete section with a TODO referencing the tracking issue/PR, or ensure the real implementation lands in the same or an immediately linked PR before merge.  
  ([PR#57](https://github.com/NASA-IMPACT/MMGIS/pull/57#discussion_r3191268753))
- ✅ **addressed/high** — Don't ship functions labeled "for backwards compatibility" unless they are actually called somewhere; dead code added under a compatibility rationale still needs at least one call site to justify its inclusion.  
  ([PR#57](https://github.com/NASA-IMPACT/MMGIS/pull/57#discussion_r3191298773))
- ✅ **addressed/high** — When adding an event listener, always pair it with a removal path (removeEventListener or a stored unsubscribe handle); an unremoved listener is a memory/resource leak and a source of ghost callbacks.  
  ([PR#57](https://github.com/NASA-IMPACT/MMGIS/pull/57#discussion_r3191389941))
- ✅ **addressed/high** — When calling a function that can throw, always wrap it in try/catch and surface the error visibly to the user — silently swallowing exceptions and leaving a frozen loading state is worse than showing an error message.  
  ([PR#57](https://github.com/NASA-IMPACT/MMGIS/pull/57#discussion_r3191464083))
- ✅ **addressed/high** — When toggling layer/component visibility, prefer the framework's native visibility API (e.g., a `visible` prop) over nullifying state — nullifying state typically triggers full teardown and rebuild, causing unnecessary data fetches and re-initialization.  
  ([PR#62](https://github.com/NASA-IMPACT/MMGIS/pull/62#discussion_r3066527618))
- ✅ **addressed/high** — Before writing a custom utility (e.g., a color parser, date formatter, URL builder), check whether the repo already depends on a library that provides the same functionality — prefer the existing dependency over hand-rolled code.  
  ([PR#62](https://github.com/NASA-IMPACT/MMGIS/pull/62#discussion_r3066569223))
- ✅ **addressed/high** — In lookup/alias maps, enforce a consistent convention for both key and value formats (e.g., keys are always the source identifier, values are always the canonical target string in lowercase); inverted or inconsistently-cased entries silently break routing logic.  
  ([PR#62](https://github.com/NASA-IMPACT/MMGIS/pull/62#discussion_r3066579672))
- ✅ **addressed/high** — Do not include entries for features/types that are not yet implemented or supported; either remove them or comment them out with a clear TODO, so the codebase only advertises what actually works.  
  ([PR#62](https://github.com/NASA-IMPACT/MMGIS/pull/62#discussion_r3066744644))
- ✅ **addressed/med** — When building a type-alias/dispatch table that routes variant type names to a shared handler, verify that every aliased type is actually compatible with that handler's behavior — silently routing structurally incompatible types to the same code path causes silent runtime failures.  
  ([PR#62](https://github.com/NASA-IMPACT/MMGIS/pull/62#discussion_r3066756356))
- ✅ **addressed/high** — When sibling branches of a switch (or if/else) define nearly identical inline helper functions, extract them to a single module-level utility rather than duplicating the logic per case.  
  ([PR#62](https://github.com/NASA-IMPACT/MMGIS/pull/62#discussion_r3066773072))
- ✅ **addressed/med** — When adding new cases to a switch/dispatch table, always update the default-branch error message that enumerates supported types — stale "supported values" lists in error messages mislead developers debugging invalid inputs.  
  ([PR#62](https://github.com/NASA-IMPACT/MMGIS/pull/62#discussion_r3066783992))
- ✅ **addressed/high** — When introducing a utility function, check whether an existing utility already covers the same case; duplicate helpers with subtle behavioral divergence (e.g., different param formats, different gating conditions) are a maintenance hazard and should be consolidated into one canonical implementation.  
  ([PR#62](https://github.com/NASA-IMPACT/MMGIS/pull/62#discussion_r3082416167))
- ✅ **addressed/high** — When the same fallback data list appears in multiple code paths (e.g., success path, failure callback, and non-TiTiler branch), extract it into a single named constant so there is one source of truth to update and the intent of "use this as the fallback" is explicit.  
  ([PR#63](https://github.com/NASA-IMPACT/MMGIS/pull/63#discussion_r3276885325))
- ✅ **addressed/high** — Extract provider-specific tile configuration (URLs, tile sizes, zoom offsets, attribution strings) into named constants in a dedicated helper or config file rather than scattering magic numbers and strings inline throughout adapter methods.  
  ([PR#75](https://github.com/NASA-IMPACT/MMGIS/pull/75#discussion_r3147678694))
- ✅ **addressed/high** — When calling a resolver/factory function, verify that every argument you pass is actually consumed by it; parameters computed but never read (dead inputs) should be removed from both the call site and the function signature.  
  ([PR#75](https://github.com/NASA-IMPACT/MMGIS/pull/75#discussion_r3147696765))
- ✅ **addressed/high** — Flag and remove empty/no-op destructuring statements (e.g., `const { } = props`) — they are dead code that add noise without any runtime effect and indicate incomplete refactoring.  
  ([PR#75](https://github.com/NASA-IMPACT/MMGIS/pull/75#discussion_r3147738513))
- ✅ **addressed/high** — When adding example or reference tools in a React codebase, implement them as proper React components rather than using imperative DOM manipulation (e.g., jQuery), so they model the project's idiomatic patterns for contributors.  
  ([PR#80](https://github.com/NASA-IMPACT/MMGIS/pull/80#discussion_r3203167084))
- ✅ **addressed/high** — Replace setTimeout-based layout hacks that hardcode CSS transition durations with ResizeObserver (or MutationObserver/IntersectionObserver), which fires when the DOM actually changes, is batched per frame, and stays correct if transition timings change.  
  ([PR#80](https://github.com/NASA-IMPACT/MMGIS/pull/80#discussion_r3203303435))
- ✅ **addressed/high** — When detecting a duplicate key/ID during a registration or mapping operation, skip (return early) rather than overwriting the existing entry — logging a warning but continuing silently corrupts state and makes the duplicate harder to diagnose.  
  ([PR#80](https://github.com/NASA-IMPACT/MMGIS/pull/80#discussion_r3203790266))
- ✅ **addressed/high** — TODO/FIXME comments must not reference internal task identifiers (e.g., sprint numbers, JIRA keys) without a link or inline explanation — opaque codes are meaningless to future readers outside the original planning context; either add a URL to the tracker, explain the context inline, or drop the reference entirely.  
  ([PR#85](https://github.com/NASA-IMPACT/MMGIS/pull/85#discussion_r3277364314))
- ⚠️ **ignored/high** — Event names in a public API or event bus should be self-explanatory and justify any non-obvious qualifiers (e.g., userChanged vs. updated); if a qualifier encodes the trigger source, that intent should be documented or made clear in the naming convention.  
  ([PR#108](https://github.com/NASA-IMPACT/MMGIS/pull/108#discussion_r3351719252))
- ⚠️ **ignored/high** — Do not merge TODO comments without either resolving the debt in the same PR or linking to a tracked issue; unanchored TODOs become permanent dead weight.  
  ([PR#108](https://github.com/NASA-IMPACT/MMGIS/pull/108#discussion_r3351738351))
- ⚠️ **ignored/high** — Components should be self-contained: avoid importing from directories outside the component's own folder tree; if a sibling component needs a shared utility, move that utility to a shared/common layer rather than reaching across unrelated subtrees.  
  ([PR#113](https://github.com/NASA-IMPACT/MMGIS/pull/113#discussion_r3383360516))
- ⚠️ **ignored/high** — When adding or updating CI workflow files, pin the latest available LTS version of runtimes (Node.js, Python, etc.) rather than an older version, so the PR does not introduce outdated tooling from the start.  
  ([PR#154](https://github.com/NASA-IMPACT/MMGIS/pull/154#discussion_r3431215940))
- ⚠️ **ignored/high** — When a PR introduces a partial UI or schema that only covers a subset of available configuration options, document explicitly in the PR (or in code comments/README) what is covered, what is intentionally omitted, and the plan for closing the gap — avoid shipping incomplete coverage silently.  
  ([PR#57](https://github.com/NASA-IMPACT/MMGIS/pull/57#discussion_r3191172360))
- ⚠️ **ignored/high** — Do not ship new code that is unreachable or uncalled in the current PR; if a utility is intended for future use, add it only when it has an actual caller, or track it as a follow-up issue rather than dead code in production.  
  ([PR#57](https://github.com/NASA-IMPACT/MMGIS/pull/57#discussion_r3191421275))
- ⚠️ **ignored/high** — When a class field is guaranteed to be non-null by a documented invariant (e.g., always set before any method that uses it), access it consistently without optional chaining; mixing `?.` and direct access on the same field across a class obscures whether the invariant actually holds and forces reviewers to reason about reachability manually.  
  ([PR#57](https://github.com/NASA-IMPACT/MMGIS/pull/57#discussion_r3191442485))
- ⚠️ **ignored/high** — When a PR introduces a custom replacement for an external dependency or interface, all existing consumers of the old dependency must be updated in the same PR — do not leave dependent code in a broken state.  
  ([PR#63](https://github.com/NASA-IMPACT/MMGIS/pull/63#discussion_r3276860936))
- ⚠️ **ignored/low** — When introducing a new configuration option (e.g., external service URL) for one layer type, audit all similar layer types to determine whether they should consistently expose the same option — partial feature coverage creates confusing asymmetry in the API surface.  
  ([PR#63](https://github.com/NASA-IMPACT/MMGIS/pull/63#issuecomment-4308339388))
- ⚠️ **ignored/high** — When a component supports multiple target environments or planets/regions, default configuration values must not be hard-coded to a single environment (e.g., Earth-centric coordinates); derive defaults from the user's selection or use neutral/zero values.  
  ([PR#75](https://github.com/NASA-IMPACT/MMGIS/pull/75#discussion_r3196954962))
- ⚠️ **ignored/high** — When branching on an enum or discriminated type, avoid implicit fallthrough: either use an exhaustive switch with a default that throws, or add explicit guards for every known variant so that unknown/future values fail loudly rather than silently picking a wrong default.  
  ([PR#75](https://github.com/NASA-IMPACT/MMGIS/pull/75#discussion_r3197224108))
- ⚠️ **ignored/high** — Hardcoded provider URLs and access-token-bearing style references belong in configuration (env vars, config files, or runtime-supplied defaults), not source code — embedding them makes per-deployment customization require a code change and hides token-coupling that varies across environments.  
  ([PR#75](https://github.com/NASA-IMPACT/MMGIS/pull/75#discussion_r3197264398))
- ⚠️ **ignored/high** — Avoid parallel mutable state fields that must be kept in sync (e.g., `.style` for current and `.styles` for the collection): prefer a single source of truth (an index into one array, or a derived getter) so that a rename or selection change cannot produce inconsistency between the two fields.  
  ([PR#75](https://github.com/NASA-IMPACT/MMGIS/pull/75#discussion_r3197299297))
- ⚠️ **ignored/high** — When a public API endpoint accepts structured data (e.g. GeoJSON, JSON schemas), validate the structure/schema before processing — a truthiness check alone is insufficient and can propagate malformed data silently into downstream layers.  
  ([PR#75](https://github.com/NASA-IMPACT/MMGIS/pull/75#discussion_r3202466856))
- ⚠️ **ignored/high** — Public API handlers that silently return false on failure should emit a console.warn/error explaining WHY they failed; silent boolean returns make callers impossible to debug.  
  ([PR#75](https://github.com/NASA-IMPACT/MMGIS/pull/75#discussion_r3202506123))
- ⚠️ **ignored/high** — Do not add utility functions to a PR unless they are actually called somewhere; if the function belongs to a more general abstraction layer than its current file, place it in a shared utility module instead; and never let a new function absorb an existing JSDoc comment that belongs to the function immediately below it.  
  ([PR#75](https://github.com/NASA-IMPACT/MMGIS/pull/75#discussion_r3202697763))
- ⚠️ **ignored/high** — When a "switch/update" code path is added alongside an "init" code path, verify that all side-effects from init (e.g., updating map constraints like minZoom) are also applied in the switch path to maintain behavioral parity.  
  ([PR#75](https://github.com/NASA-IMPACT/MMGIS/pull/75#discussion_r3202874426))
- ⚠️ **ignored/high** — When a new private initialization method duplicates the logic of an existing public/private method (resolve spec, create layer, add to map), refactor so the init method delegates to the existing one rather than repeating the steps.  
  ([PR#75](https://github.com/NASA-IMPACT/MMGIS/pull/75#discussion_r3202883186))
- ❔ **unclear/low** — When introducing a hardcoded allowlist (MIME types, file extensions, roles, etc.), document in a comment why specific entries are included or excluded so reviewers and future maintainers can evaluate completeness without guessing intent.  
  ([PR#111](https://github.com/NASA-IMPACT/MMGIS/pull/111#discussion_r3349877074))
- ❔ **unclear/low** — Calibrate error message verbosity to the trust level of the caller: admin-gated or authenticated endpoints can return specific, actionable error details, whereas public endpoints should return vague messages to avoid leaking internal state.  
  ([PR#111](https://github.com/NASA-IMPACT/MMGIS/pull/111#discussion_r3350047613))
- ❔ **unclear/med** — Inline comments that describe security/authorization behavior must be accurate — a comment claiming a guard "passes under AUTH=none" that is actually incorrect can mislead future developers into wrong assumptions about the access control posture; verify the claim before committing the comment.  
  ([PR#111](https://github.com/NASA-IMPACT/MMGIS/pull/111#discussion_r3350433246))
- ❔ **unclear/med** — When introducing closely related type definitions, verify they cannot be unified before exposing them as separate public API surface — prefer fewer, more composable types over a proliferation of near-duplicate abstractions.  
  ([PR#35](https://github.com/NASA-IMPACT/MMGIS/pull/35#discussion_r2849566400))
- ❔ **unclear/low** — When adding configuration or UI options for flexibility, audit the exposed surface area: prefer hiding advanced or rarely-needed knobs behind defaults rather than surfacing every possible option, to avoid overwhelming users.  
  ([PR#35](https://github.com/NASA-IMPACT/MMGIS/pull/35#pullrequestreview-3850511427))
- ❔ **unclear/low** — When an async initializer is called without await, downstream code that runs synchronously immediately after may operate on still-null state; always propagate the Promise (await the call or make the caller async) or use a ready-callback pattern to prevent silent failures.  
  ([PR#72](https://github.com/NASA-IMPACT/MMGIS/pull/72#issuecomment-4253443638))

## doc-freshness (22)

_Verdict mix: 

- ✅ **addressed/high** — When an ADR or design doc describes cardinality relationships between system entities, verify the stated relationship (one-to-one, one-to-many, many-to-many) matches the actual architectural decision before merging — an incorrect cardinality misleads all future readers about a core constraint.  
  ([PR#112](https://github.com/NASA-IMPACT/MMGIS/pull/112#discussion_r3363490974))
- ✅ **addressed/high** — ADR constraints must precisely scope what is excluded: an overly broad "no uploads" rule that silently excludes a needed capability (static asset uploads) will be caught in review — always distinguish between the specific category being restricted (geodata, large files, etc.) and the carve-outs that remain allowed.  
  ([PR#112](https://github.com/NASA-IMPACT/MMGIS/pull/112#discussion_r3363499597))
- ✅ **addressed/high** — Architecture decision records must reflect the current in/out-of-scope decisions for every feature they mention; a feature being dropped or gated should be removed from or clearly qualified in all ADR sections that imply it remains active.  
  ([PR#112](https://github.com/NASA-IMPACT/MMGIS/pull/112#discussion_r3365219320))
- ✅ **addressed/high** — When documenting cardinality relationships in architecture docs, state them precisely and unambiguously (e.g., "one-to-one" or "one-to-many") rather than using phrasing that can be read either way; ambiguous cardinality forces reviewers to ask clarifying questions that a single explicit sentence would have prevented.  
  ([PR#112](https://github.com/NASA-IMPACT/MMGIS/pull/112#discussion_r3365223774))
- ✅ **addressed/high** — When an ADR or design doc describes existing code behavior to explain a new feature, use precise language that accurately reflects what the code actually does — vague or incorrect characterizations (e.g., "no-op" instead of "warn-and-bail") prompt reviewer confusion about whether behavior is new or pre-existing.  
  ([PR#112](https://github.com/NASA-IMPACT/MMGIS/pull/112#discussion_r3365228808))
- ✅ **addressed/med** — ADRs should describe phases (what), not time-boxed estimates (when); calendar-bound durations belong in project plans, not architectural decision records, where they quickly become stale and misleading.  
  ([PR#23](https://github.com/NASA-IMPACT/MMGIS/pull/23#discussion_r2813010165))
- ✅ **addressed/med** — Verify that all internal anchor links in documentation (ADRs, READMEs, specs) resolve correctly before merging; Markdown heading anchors are fragile and break silently when headings are renamed or sections are moved.  
  ([PR#23](https://github.com/NASA-IMPACT/MMGIS/pull/23#discussion_r2813013751))
- ✅ **addressed/low** — In ADRs and design docs, every section that lists options must consistently label the chosen option (e.g., "(Selected)") so readers can immediately identify the decision without scanning the full text.  
  ([PR#23](https://github.com/NASA-IMPACT/MMGIS/pull/23#discussion_r2813049304))
- ✅ **addressed/high** — Each ADR should cover a single architectural concern; when a document bundles multiple independent decisions (e.g., layout AND theming), split them into separate ADRs so each record stays focused and independently approvable.  
  ([PR#23](https://github.com/NASA-IMPACT/MMGIS/pull/23#discussion_r2815646020))
- ✅ **addressed/high** — Before marking a third-party design system or library as "Selected" in an ADR, verify that its required artifacts (component library, branding tokens, public documentation) actually exist and are accessible; if availability is uncertain, defer the decision or flag it as a dependency risk rather than stating it as resolved.  
  ([PR#23](https://github.com/NASA-IMPACT/MMGIS/pull/23#discussion_r2815677294))
- ✅ **addressed/high** — ADRs and design docs that leave the door open to "multiple design systems" or "future theme galleries" should instead state an explicit single-system commitment; vague multi-system aspirations create long-term maintenance complexity and should be resolved to a clear scope before approval.  
  ([PR#23](https://github.com/NASA-IMPACT/MMGIS/pull/23#discussion_r2815724543))
- ✅ **addressed/high** — API docs must explicitly document known limitations and unsupported usage patterns (e.g., "multiple instances not supported", "IDs must be unique or events will collide") — omitting constraints leads to silent runtime failures for integrators.  
  ([PR#36](https://github.com/NASA-IMPACT/MMGIS/pull/36#discussion_r2880329565))
- ✅ **addressed/high** — When removing a feature or configuration option, audit all documentation for dangling references or incomplete sentences that referenced the removed concept — stubs left behind ("takes precedence over .") signal the doc was never updated to match the code change.  
  ([PR#57](https://github.com/NASA-IMPACT/MMGIS/pull/57#discussion_r3191396997))
- ✅ **addressed/high** — Documentation must not contain empty section headings or notes referencing blank text — catch placeholder/stub content (e.g., `### ` with no label, `**Note**: ... over .`) before merging.  
  ([PR#57](https://github.com/NASA-IMPACT/MMGIS/pull/57#discussion_r3191400644))
- ✅ **addressed/high** — Documentation examples must not contain empty or placeholder keys/fields — if a config field name is not yet finalized, omit the entire section rather than publishing incomplete schema stubs that confuse readers.  
  ([PR#57](https://github.com/NASA-IMPACT/MMGIS/pull/57#discussion_r3191403693))
- ✅ **addressed/high** — Example/template config files should enumerate ALL available configuration keys (even those using defaults), so they serve as complete reference documentation for users implementing their own instances.  
  ([PR#80](https://github.com/NASA-IMPACT/MMGIS/pull/80#discussion_r3203171852))
- ⚠️ **ignored/high** — In config/UI descriptions, document restrictions and engine-specific exceptions rather than enumerating all compatible contexts; "only works with X" or "no effect on Y" is more actionable than "works with X and Y."  
  ([PR#75](https://github.com/NASA-IMPACT/MMGIS/pull/75#discussion_r3197148848))
- ⚠️ **ignored/high** — When updating JSDoc comments that describe adapter/implementation behavior, verify the description matches how the code actually works — reviewers should challenge claims that may be inaccurate before the doc ships.  
  ([PR#75](https://github.com/NASA-IMPACT/MMGIS/pull/75#discussion_r3202592592))
- ❔ **unclear/low** — When an ADR introduces a new API or global alongside an existing one, it must explicitly document the relationship between them (supersedes, wraps, coexists, or migrates) and include the existing API in the migration path — leaving this implicit causes integration confusion for implementers.  
  ([PR#13](https://github.com/NASA-IMPACT/MMGIS/pull/13#pullrequestreview-3778444838))
- ❔ **unclear/low** — ADRs must include concrete configuration/interface examples for every proposed abstraction, and must spell out what any described lifecycle (e.g. "minimally updated") actually changes — vague labels without specifics are not acceptable in an approved ADR.  
  ([PR#23](https://github.com/NASA-IMPACT/MMGIS/pull/23#issuecomment-3909195758))
- ❔ **unclear/low** — When defining enum-like constants that represent related but distinct states, JSDoc comments must clearly distinguish every state combination — especially pairs that could appear semantically equivalent (e.g., `focused` vs `expanded+tabbed`). Each state's definition should explain what uniquely triggers it and how it differs from its nearest neighbor.  
  ([PR#35](https://github.com/NASA-IMPACT/MMGIS/pull/35#discussion_r2849531968))
- ❔ **unclear/med** — When a sort uses a counter-intuitive convention (e.g., lower numeric value = higher priority), comments and JSDoc must state both the sort direction AND the semantic meaning; "sorted by priority (lowest first)" is ambiguous and should instead say "sorted ascending by priority value (priority 0 = highest precedence)".  
  ([PR#47](https://github.com/NASA-IMPACT/MMGIS/pull/47#discussion_r3024722202))

## org-convention-security (7)

_Verdict mix: 

- ✅ **addressed/high** — When excluding a file type on security grounds, document the actual threat model and trust boundary in the code; if the upload surface is restricted to trusted users, blanket exclusions may be unnecessarily restrictive and should be justified against the real attack surface.  
  ([PR#111](https://github.com/NASA-IMPACT/MMGIS/pull/111#discussion_r3349884416))
- ✅ **addressed/high** — Prefer a single concise JSDoc comment at the top of a class/function describing its purpose; add inline comments only when the logic is non-obvious. Remove comments that merely restate what the code already clearly says.  
  ([PR#22](https://github.com/NASA-IMPACT/MMGIS/pull/22#discussion_r2797970162))
- ✅ **addressed/med** — When an ADR selects an org-mandated standard (e.g., a NASA-wide design system), document it as the canonical foundation rather than as one option among several; do not suggest swapping to an alternative without first obtaining explicit justification from the relevant teams confirming why the standard does not apply.  
  ([PR#23](https://github.com/NASA-IMPACT/MMGIS/pull/23#discussion_r2815746348))
- ✅ **addressed/high** — Development-only middleware (e.g., CORS bypass proxies, debug endpoints) must be gated with a NODE_ENV=development guard so they are never active in production, even if the comment or docs suggest production shouldn't need them.  
  ([PR#62](https://github.com/NASA-IMPACT/MMGIS/pull/62#discussion_r3050559686))
- ✅ **addressed/high** — Development-only infrastructure (CORS proxies, debug endpoints, mock interceptors) must be guarded by an environment check (e.g. `process.env.NODE_ENV === 'development'`) so they never run in production.  
  ([PR#62](https://github.com/NASA-IMPACT/MMGIS/pull/62#discussion_r3066427460))
- ✅ **addressed/high** — When inserting user-controlled or config-derived values into the DOM (especially as attributes or element content), always use safe DOM construction methods (e.g., jQuery `.attr()`, `.text()`, `.addClass()` or `DOMPurify`) rather than template literal interpolation directly into HTML strings, to prevent XSS.  
  ([PR#80](https://github.com/NASA-IMPACT/MMGIS/pull/80#discussion_r3191581497))
- ✅ **addressed/high** — When inserting user-controlled or config-sourced strings into the DOM, always use safe DOM APIs (e.g., jQuery .text(), .attr(), or DOMPurify) instead of template-literal HTML construction — unsanitized interpolation into innerHTML or jQuery HTML strings is an XSS vector.  
  ([PR#80](https://github.com/NASA-IMPACT/MMGIS/pull/80#discussion_r3191585186))

## project-alignment (8)

_Verdict mix: 

- 🔵 **acknowledged-no-change/high** — When a project has an established internal eventbus, new code must use it rather than dispatching raw DOM CustomEvents — bypassing the eventbus creates an inconsistent event topology and breaks listeners that only subscribe through the established channel.  
  ([PR#47](https://github.com/NASA-IMPACT/MMGIS/pull/47#discussion_r3028474719))
- ✅ **addressed/high** — Plugin-specific functionality that is broadly useful (e.g., file upload) must not be implemented as a plugin-private route; extract it into a generic core module that any plugin can reuse, keeping plugins truly plug-and-play.  
  ([PR#111](https://github.com/NASA-IMPACT/MMGIS/pull/111#discussion_r3351200565))
- ✅ **addressed/high** — Place components under a folder whose name reflects their semantic domain; a general-purpose UI component must not live inside a domain-specific subfolder (e.g., geo/, auth/) — use the canonical "components/" layout established elsewhere in the repo/monorepo.  
  ([PR#111](https://github.com/NASA-IMPACT/MMGIS/pull/111#discussion_r3351236096))
- ✅ **addressed/med** — New components must follow the repo's established reusable-component/monorepo pattern; standalone component files that duplicate structure already defined by that pattern should be refactored to conform before merging.  
  ([PR#115](https://github.com/NASA-IMPACT/MMGIS/pull/115#discussion_r3375536153))
- ✅ **addressed/high** — When a project has an established internal event bus or messaging abstraction, new code must use it rather than reaching for raw browser APIs (e.g. window.dispatchEvent / CustomEvent). Check the project's event/messaging docs before wiring up any inter-component or cross-tool communication.  
  ([PR#97](https://github.com/NASA-IMPACT/MMGIS/pull/97#discussion_r3351682009))
- ⚠️ **ignored/med** — Before adding a new utility or hook to a shared folder, check the existing codebase (especially the development branch) for established patterns — new files may duplicate or diverge from conventions already in use for cross-tool sharing.  
  ([PR#115](https://github.com/NASA-IMPACT/MMGIS/pull/115#discussion_r3381977560))
- ⚠️ **ignored/high** — Before introducing new interfaces, types, or documentation for a specific architectural approach, verify with the team that the approach hasn't already been superseded by a prior design decision (e.g., moving from an overlay-synchronization pattern to a native layer-based pattern).  
  ([PR#75](https://github.com/NASA-IMPACT/MMGIS/pull/75#discussion_r3202568483))
- ❔ **unclear/low** — Before hardcoding a new technology or library as a project default, confirm the feature is mature enough for that commitment — premature defaults are harder to undo and signal readiness to users.  
  ([PR#62](https://github.com/NASA-IMPACT/MMGIS/pull/62#issuecomment-4226843811))

## test-quality (2)

_Verdict mix: 

- ✅ **addressed/high** — When migrating the default `test` script to a new runner, verify it still invokes ALL test suites (unit + e2e) that the old script covered; silently dropping a suite from `npm test` creates a false sense of CI coverage.  
  ([PR#150](https://github.com/NASA-IMPACT/MMGIS/pull/150#discussion_r3424243134))
- ❔ **unclear/low** — Every newly introduced module (validator, lifecycle handler, controller, etc.) must include corresponding unit or integration tests before the PR is merged — do not ship new files without test coverage.  
  ([PR#57](https://github.com/NASA-IMPACT/MMGIS/pull/57#issuecomment-4382976845))

