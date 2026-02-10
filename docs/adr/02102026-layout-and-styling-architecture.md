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
- See [Phase 6: Grid-Based Layout System](#phase-6-grid-based-layout-system-q3-2026) for planned implementation

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

#### Option 1: USWDS / Horizon

**Description**: A government-standard design system with built-in accessibility and a mature component ecosystem.

**Pros**:
- WCAG 2.1 AA compliant out of the box
- Comprehensive component library (50+ components)
- Built-in light and dark theme support
- Strong documentation and active community

**Cons**:
- May not be a perfect visual fit for all projects

---

#### Option 2: Custom Theme System (CSS Variables)

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

## Migration Path

### Phase 1: Panel Manager Foundation (Week 1-2)
- [ ] Create `PanelManager_.js` module for multi-panel state management
- [ ] Implement panel registration and tracking system
- [ ] Add panel state management (open, minimized, closed)
- [ ] Add theme loader (`Theme_.js`)

### Phase 2: Panel Controls & UI (Week 3-4)
- [ ] Design and implement panel header component with controls
- [ ] Add minimize, maximize, close button functionality
- [ ] Implement panel state transitions with animations
- [ ] Add keyboard shortcuts for panel controls (accessibility)
- [ ] Create modern panel styling with USWDS design tokens

### Phase 3: Multi-Panel Support (Week 5-6)
- [ ] Update `ToolController_.js` to support multiple active tools
- [ ] Refactor `make()` / `destroy()` lifecycle for multi-panel scenarios
- [ ] Implement backward compatibility layer for single-panel tools
- [ ] Add panel state persistence to database/local storage
- [ ] Test multi-panel scenarios (2-3 panels open simultaneously)

### Phase 4: Theming Integration (Week 7-8)
- [ ] Integrate USWDS CSS framework
- [ ] Create `geospatial-dark.css` preserving current theme as default
- [ ] Update panel components to use USWDS design tokens
- [ ] Replace `mmgisUI.css` components with USWDS equivalents
- [ ] Add theme switcher to Configure page

### Phase 5: Tool Migration & Testing (Week 9-10)
- [ ] Update 3-5 high-priority tools (Draw, Measure, Layers, Info, Legend)
- [ ] Test multi-panel scenarios with updated tools
- [ ] Document plugin migration guide for panel controls
- [ ] Update plugin template with panel best practices
- [ ] Conduct accessibility testing (keyboard navigation, screen readers)

---

## Future Roadmap

### Phase 6: Grid-Based Layout System
- [ ] Evaluate and integrate Gridstack.js library
- [ ] Create grid initialization in `UserInterfaceDefault_.js`
- [ ] Extend config schema with grid `layout` key
- [ ] Implement drag-and-drop panel positioning
- [ ] Add panel resizing with collision detection
- [ ] Migrate panel system to grid-based containers
- [ ] Implement responsive breakpoints for different screen sizes
- [ ] Test backward compatibility with enhanced panel system

### Phase 7: Visual Layout Builder
- [ ] Add drag-and-drop layout editor to Configure page
- [ ] Real-time preview of layout changes
- [ ] Export/import layout templates
- [ ] Component palette for quick plugin addition
- [ ] Visual grid overlay for alignment
- [ ] Layout validation and conflict detection

### Phase 8: Mobile Optimization
- [ ] Refactor `UserInterfaceMobile_.js` with responsive panel system
- [ ] Implement swipeable panel navigation
- [ ] Optimize plugin UI for touch interactions
- [ ] Add mobile-specific panel presets
- [ ] Test multi-panel scenarios on mobile devices

### Phase 9: Advanced Theming
- [ ] Dynamic theme generation from mission config
- [ ] High-contrast accessibility mode
- [ ] Theme gallery for user-contributed themes
- [ ] Theme preview in Configure page

### Phase 10: Plugin Marketplace Integration
- [ ] Sandboxed iframe layout for marketplace plugins
- [ ] Theme API for third-party plugins
- [ ] Layout validation and security checks
