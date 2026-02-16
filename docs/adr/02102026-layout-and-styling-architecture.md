# Layout and Styling Architecture for MMGIS

- **Status**: PROPOSED
- **Date**: 2026-02-10
- **Deciders**: MMGIS Core Team
- **Tags**: layout, styling, ui, panel-system, multi-panel, theming

---

## Executive Summary

Modernize MMGIS's layout and styling architecture to support a flexible, themable plugin framework that aligns with USWDS/Horizon design systems.

**Key Changes**:
- **Layout**: Enhance current panel system with multi-panel support, minimize/close controls, and modern spacing
- **Styling**: Migrate from hard-coded dark theme to flexible, design system-aligned theming
- **Configuration**: Extend mission/tool configs to support panel configuration and theme customization

**Benefits**:
- **Multi-Panel Support**: Multiple plugins can be open simultaneously with independent controls
- **Usability**: Covers our core use cases with incremental enhancement path
- **Consistency**: Align with existing design standards (USWDS/Horizon)
- **Future-proof**: Foundation for grid-based layout system in later development cycle

---

## Terminology Note

To avoid confusion, we use internal terms that differ from MMGIS framework conventions:

| Our Term | MMGIS Framework Term | Description |
|----------|---------------------|-------------|
| Tool | Mission | Each unique instance of MMGIS dashboard |
| Plugin / Component | Tool | Individual interactive components (Draw, Measure, etc.) |

*Note: Custom plugins/components we develop will be located in the `src/essence/Tools/` directory in MMGIS codebase.*

---

## Context and Problem Statement

### Current State: Layout

MMGIS uses a **fixed panel system** where plugins attach to pre-defined containers. Panels interact with the map in two ways:

```
┌──────────────────────────────────────────────────────────┐
│                     Top Panel (Header)                   │
│              [Logo] [Title] [View Switcher]              │
├──────────┬───────────────────────────────────────────────┤
│          │                                               │
│  Left    │                                               │
│  Panel   │          Map Canvas (Leaflet/Cesium)          │
│ (slides) │                                               │
│          │  ┌─────────────┐                              │
│          │  │  Floating   │                              │
│          │  │  Panel      │                              │
├──────────┴──┴─────────────┴──────────────────────────────┤
│               Bottom Panel (slides up)                   │
└──────────────────────────────────────────────────────────┘
```

#### Panel Types

| Type | Behavior | Code Configuration | Examples |
|------|----------|-------------------|----------|
| **Left Panel** | Slides from left, resizes map canvas | `height: 0` | Info Tool |
| **Bottom Panel** | Slides from bottom, resizes map canvas | `height > 0` | Measure Tool |
| **Floating Panel** | Overlays map, doesn't resize canvas | `"separatedTool": true` | Legend Tool |

**Configuration Example**:
```javascript
// Left Panel Tool
const InfoTool = {
    height: 0,  // Triggers left panel
    width: 300,
    make: function() { ... }
}

// Floating Panel Tool (in config)
{
    "name": "LegendTool",
    "separatedTool": true  // Becomes floating
}
```

#### Desktop vs Mobile View

| Feature | Desktop | Mobile |
|---------|---------|--------|
| Panel Support | All three types | Bottom Panel only |
| Map Views | 2D Map, 3D Globe, Image Viewer | 2D Map only |
| Toolset | All 16+ plugins | Reduced set (many hidden) |

### Problems with Current Layout

| Problem | Impact |
|---------|--------|
| **Single-Active Component** | Only one plugin active at a time; activating new one destroys previous |
| **No Panel Controls** | Cannot minimize or close panels without switching tools |
| **Limited Floating Panels** | Floating panels stack and obstruct each other |
| **Basic Visual Design** | Panels lack modern styling, spacing, and visual hierarchy |
| **No Multi-Panel Management** | Cannot manage multiple open panels simultaneously |

### Current State: Styling

MMGIS uses a **centralized CSS architecture** with a dark geospatial theme.

```
src/css/
├── mmgis.css           # Core styles, :root variables, animations
├── mmgisUI.css         # UI components (buttons, sliders, checkboxes)
├── external/           # Third-party library overrides
│   ├── leaflet.css
│   └── tempus-dominus.css
└── tools.css           # Built-in tool-specific styles

src/essence/Tools/<ToolName>/
└── <ToolName>Tool.css  # Component-specific styles
```

**Current Theming via CSS Variables**:
```css
/* mmgis.css */
:root {
    --color-a: #1c1c1c;  /* Dark background */
    --color-b: #2e2e2e;  /* Panel background */
    --color-k: #000000;  /* Pure black */
    --main-color: #00d8ff;  /* Accent color */
}
```

### Problems with Current Styling

| Problem | Impact |
|---------|--------|
| **Hard-coded Dark Theme** | No light mode or alternative themes |
| **Dynamic Inline Styles** | JavaScript frequently injects styles; hard to override |
| **High-Specificity Overrides** | Third-party library overrides require `!important` chains |
| **No Design System Integration** | Doesn't align with USWDS/Horizon standards |

---

## Decision Drivers

1. **Multi-Panel Support**: Enable multiple active plugins simultaneously (e.g., Draw + Measure + Layers)
2. **Modern Visual Design**: Improve panel styling with proper spacing, and visual hierarchy
3. **Floating Panel Management**: Better z-index and stacking management for overlapping panels
4. **Design System Alignment**: Match USWDS or Horizon for enterprise consistency
5. **Configuration-Driven**: Panel behavior and theming defined in mission/tool configs, not hard-coded
6. **Gradual Migration**: Can adopt incrementally without rewriting all 16+ existing tools
7. **Incremental Enhancement**: Build foundation for future grid-based layout system

---

## Assumptions

1. **Panel Architecture Preservation**: Current panel system (left, bottom, floating) can be enhanced without fundamental rewrite
2. **Desktop-First**: Initial implementation focuses on desktop; mobile layout improvements are future work
3. **Backward Compatibility**: Existing tools continue working with current configuration until migrated
4. **Plugin Lifecycle Compatibility**: `make()` and `destroy()` functions can be minimally updated to support multi-panel scenarios
5. **Grid Layout Deferred**: Full grid-based layout system (Gridstack.js) will be implemented in a later development cycle

---

## Considered Options

#### Option 1: Enhanced Panel System (Selected)

**Description**: Extend current panel system with multi-panel support, modern controls, and improved visual design.


**Panel Features**:
- **Multi-Panel Support**: Multiple tools can be open simultaneously
- **Panel Controls**: Minimize, maximize, close buttons on panel header
- **Modern Styling**: Box shadows, border radius, proper spacing, visual hierarchy
- **State Persistence**: Remember panel states across sessions

**Pros**:
- Minimal refactoring of existing architecture
- Works with current jQuery/D3 codebase
- Preserves existing panel types (left, bottom, floating)
- Can be implemented incrementally

**Cons**:
- Still limited to pre-defined panel positions
- Cannot arbitrarily position panels on screen
- Less flexible than full grid system

**Why chosen**:
- Delivers immediate value without major refactoring
- Addresses core usability issues (single-panel limitation)
- Provides foundation for future grid-based system
- Low risk, high impact enhancement

---

#### Option 2: Gridstack.js Grid System (Deferred to Future)

**Description**: Full grid-based layout with drag-and-drop positioning.

**Why deferred**:
- More complex than needed for current requirements
- Can be added later as enhancement to panel system
- Requires more extensive testing and migration effort

---

#### Option 3: Complete UI Rewrite with React

**Description**: Modernize entire frontend with React framework.

**Why rejected**:
- Too disruptive for current development cycle
- Would require rewriting all 16+ existing tools
- Significant effort (months) with high risk
- Can be reconsidered in future major version

---

### Styling

#### Option 1: USWDS / Horizon (Selected)

**Description**: A government-standard design system with built-in accessibility and a mature component ecosystem.

**Pros**:
- WCAG 2.1 AA compliant out of the box
- Comprehensive component library (50+ components)
- Built-in light and dark theme support
- Strong documentation and active community

**Cons**:
- May not be a perfect visual fit for all projects

---

#### Option 2: Custom Theme System (CSS Variables) (Deferred)

**Description**: A flexible, custom theming approach built on top of CSS variables.

**Pros**:
- Highly customizable to meet individual project needs
- Enables future creation of custom themes for different deployments

**Cons**:
- Significant upfront effort to design and maintain a theme architecture
- Requires defining and maintaining themes for each project

---

#### Decision

Adopt **USWDS / Horizon** as the default design system to ensure accessibility, consistency, and faster delivery.
In parallel, structure the codebase to support theming so that USWDS becomes one of several themes in a future theme gallery, enabling customization as needs evolve.

---

## Implementation Details

### Core Architecture

**Panel Management System (`PanelManager_.js`)**
- Multi-panel state management with registration and tracking
- Panel state lifecycle (open, minimized, closed) with persistence
- Backward compatibility layer for single-panel tools

**Tool Controller Enhancements (`ToolController_.js`)**
- Support for multiple simultaneously active tools
- Updated `make()` / `destroy()` lifecycle for multi-panel scenarios
- Plugin API for panel controls and state management

**Theme System (`Theme_.js`)**
- USWDS design token integration
- Default geospatial-dark theme preserving current aesthetics
- Theme configuration by extracting css properties to a single file

**Panel UI Components**
- Standardized panel header with minimize, maximize, close controls
- State transition animations and accessibility (keyboard shortcuts)
- USWDS-based styling replacing legacy `mmgisUI.css` components

### Future Extensibility

**Grid-Based Layout System**
- Drag-and-drop panel positioning with Gridstack.js or similar
- Panel resizing with collision detection
- Responsive breakpoints for different screen sizes
- Config schema extensions for layout persistence

**Visual Layout Builder**
- Drag-and-drop editor in Configure page
- Real-time layout preview and template export/import
- Visual grid overlay for alignment and validation

**Mobile Optimization**
- Responsive panel system in `UserInterfaceMobile_.js`
- Touch-optimized interactions and swipeable navigation
- Mobile-specific panel presets

**Advanced Theming**
- Dynamic theme generation from mission configuration
- High-contrast accessibility modes
- Community theme gallery and preview system

**Plugin Marketplace Integration**
- Sandboxed layout environments for third-party plugins
- Theme API for external plugin compatibility
- Security validation and layout checks
