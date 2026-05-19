# MMGIS Modern Layout: Tool Rendering Pipeline

## Overview

The modern layout system transforms mission configurations into a fully functional panel-based UI through a **6-phase pipeline**. This ensures tools are validated, optimally assigned to compatible layout panels, and rendered cleanly without blocking the browser's DOM thread.

---

## 1. Configuration Validation
**Module:** `src/essence/modern.js` / `DashboardConfigValidator.js`

The entry point (`modern.js`) validates the incoming mission configuration (e.g., `tab-ui-config.json`) using the `validateModernConfig` function. Invalid configurations halt initialization, ensuring subsequent phases work with guaranteed schemas.

## 2. Panel Registration
**Module:** `src/essence/modern.js` → `src/essence/Basics/PanelManager_/PanelManager_.ts`

The validated dashboard configuration declares available UI panels (e.g., left, right, bottom). `_registerPanels()` feeds these into the `PanelManager_`, which initializes a state object (`PanelStateObject`) for each panel, tracking its default state (`iconified`, `expanded`, etc.), position, and capability constraints.

## 3. Tool Metadata Generation
**Module:** `src/essence/Basics/ToolController_/ToolControllerModern_.js`

Tools defined in the mission configuration are processed to generate normalized metadata. The `buildToolConfigMap` function parses properties like layout orientation, preferred positions, and custom icons. This step produces a clean `ToolMetadata` object used for capability matching, separating visual logic from core tool behavior.

## 4. Tool Assignment
**Module:** `src/essence/Basics/ToolController_/ToolControllerModern_.js`

Tools are assigned to specific panels based on their metadata and panel constraints using a two-pass algorithm:

1. **Pass 1 (Explicit Assignment):** Tools explicitly named in a panel's `panelTools` array are assigned to that panel, provided they meet orientation and capability constraints.
2. **Pass 2 (Fallback Assignment):** Unassigned tools are matched to panels based on their `preferredPosition` or the first compatible available panel.

## 5. DOM Rendering
**Module:** `src/essence/Basics/UserInterface_/UserInterfaceModern_.js`

The `UserInterfaceModern_.render()` method constructs the physical HTML structure:
- It generates the CSS Grid layout mapping.
- It iterates through registered panels, creating their respective DOM containers (Icon Trays, Headers, Bodies).
- **Crucial Step:** It creates empty placeholder `.ui-tool-card` containers for the assigned tools but **does not load the tools immediately**. Instead, it pushes a `loadTool` callback into a central `toolLoadQueue`.

## 6. Tool Loading
**Module:** `src/essence/Basics/UserInterface_/UserInterfaceModern_.js` → `src/essence/Basics/ToolController_/ToolControllerModern_.js`

To prevent DOM race conditions and ensure CSS layout calculations are finalized, the pending `toolLoadQueue` is executed asynchronously using `setTimeout(fn, 0)`.

Once triggered, `ToolControllerModern_.loadTool()` is called for each pending tool. This method locates the tool module, calls its `initialize()` method, and delegates DOM injection by invoking the tool's `make(targetId)` method inside its assigned placeholder container.
