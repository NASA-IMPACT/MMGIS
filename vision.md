# Vision — Spatial Visualization Tool Builder & Plugin Marketplace

> This is the grounding document for the project. It exists to keep every downstream decision anchored to *why* we are doing this. When in doubt about a design choice, come back here. Keep it short — one to two pages; detail belongs in requirements/architecture/planning docs. 
> It only gets updated when the stakeholder or team lead directly request it.

## Why this exists

NASA science teams need custom spatial visualization tools to showcase their data products — potentially 40+ new tools a year. Today each one is built from scratch: expensive, slow, and dependent on specialized React/geospatial expertise. That is a major, recurring cost in development and maintenance.

The fix: let **non-coders assemble custom spatial visualization apps from reusable plugins**, instead of having developers hand-build each tool. Developers build plugins once; many teams reuse them.

## What we're building

A **plugin-based spatial-visualization UI framework** — a pure frontend framework, decoupled from any particular backend. It has two deliverables:

1. **The tool builder** — a WYSIWYG interface where a non-coder picks plugins, arranges them on the screen, connects them to each other, and configures data sources to assemble a complete visualization app. No coding required.
2. **The visualization app** — the spatial dashboard the builder produces: spatial layers (mission data, CO₂ emissions, etc.) plus interactive UI elements for exploring the data. Exportable as a **statically deployable app** (e.g. push the package to S3) so it can run independently of the builder.

Feeding both is a **plugin marketplace**: developers build plugins, push them, and they become available in the builder for non-coders to pick and choose.

## How it works

- **Assemble, don't code.** A non-coder selects a plugin or set of plugins, places them in the layout, and wires them together — what you see is what you get.
- **Plugins connect to each other.** A plugin's output/data-type connects to another plugin's input. Example: a *datetime* plugin feeds a *statistics* plugin — select an area of interest and a datetime, and it calls an API to fetch statistics for that selection.
- **Layout freedom.** The builder decides where plugins live — left, right, bottom, panels arranged however they want — rather than every plugin having one fixed slot. Some plugins will declare orientation/placement restrictions, and that's fine; those constraints belong to the plugin.
- **Plugins are lightweight and decoupled.** The core exposes an API; plugins build on top of it without modifying the core. Two plugins that do similar things can be swapped without core changes. Communication is message/event-based.

## Relationship to MMGIS

We are building this framework **on top of MMGIS** — an existing multi-mission spatial information system, originally built for non-Earth missions (Mars, lunar). MMGIS already checks many boxes (it's a configurable, plugin-flavored spatial UI), but it was built for a different purpose. We will refocus it on Earth and strip out what we don't need. Three big overhauls define the work:

1. **Real plugins, not in-tree tools.** Today an MMGIS "tool" is just code living in a folder, often hardcoded into the core and using backend APIs in coupled ways. We want true plugins: extensions layered on top of the core, fully decoupled, swappable, with no plugin code hardcoded in the core — only APIs and messaging across the boundary.
2. **Separate the UI from the services.** MMGIS today is a monolith — backend services (STAC, TiTiler, velocity server, …) are packaged with the UI, proxied, and hardcoded. We want a thin UI framework, with services living *outside* the ecosystem and reached over URL/API endpoints, so they can be deployed and swapped independently.
3. **Customizable layout.** MMGIS has a busy, fixed layout where plugins drop into predefined spots. We want layout freedom for the person building the app (work on this has already begun in the default brand).

## Who it's for

- **Non-coders / NASA science teams** — they can envision the tool they need and now build it themselves, for a specific spatial use case.
- **Plugin developers** — they build reusable plugins (and it should be *easy* to build one) and publish them to the marketplace, instead of rebuilding the same components (time pickers, map interfaces, data filters) over and over.

## Guiding principles

1. **Pure UI framework.** The core is frontend. Backends are external services reached over an API — never bundled in.
2. **Decoupling is the point.** Plugins never reach into the core; the core never hardcodes a plugin. The API + messaging boundary is sacred, because it's what makes plugins swappable and the marketplace possible.
3. **Non-coders are the primary user.** If assembling and connecting plugins requires code, we've failed.
4. **Make plugin authoring easy.** Marketplace growth depends on a low-friction developer experience.
5. **Earth-focused; shed the rest.** Keep what serves the spatial tool builder; remove mission-specific MMGIS baggage we don't need.

## What success looks like

- A non-coder assembles and deploys a working spatial visualization app from marketplace plugins — no React, no from-scratch build.
- A developer adds a new plugin without touching the core, and it works in any app built on the framework.
- Two plugins doing the same job can be swapped without code changes.
- A built app exports as a static package and deploys on its own (e.g. to S3) independent of the builder.

## Scope and non-goals

- **In scope:** the tool builder, the exportable visualization app, the plugin marketplace + plugin SDK, and the three MMGIS overhauls above.
- **Not the focus:** building/operating the backend data services themselves (STAC, eoAPI, TiTiler) — we integrate with them as external services, we don't own them. Non-Earth mission features inherited from MMGIS that don't serve this product.
