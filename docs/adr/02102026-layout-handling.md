# Layout Handling Architecture for MMGIS

- **Status**: Approved
- **Date**: 2026-02-10
- **Deciders**: MMGIS Core Team
- **Tags**: layout, ui, panel-system, multi-panel

---

## Executive Summary

Modernize MMGIS’s layout handling architecture to support a flexible, extensible plugin framework.

**Key Changes**:
- **Layout**: Enhance current panel system with multi-panel support, minimize/close controls, and modern spacing
- **Configuration**: Extend mission/tool configs to support panel configuration

**Benefits**:
- **Multi-Panel Support**: Multiple plugins can be open simultaneously with independent controls
- **Usability**: Covers our core use cases with incremental enhancement path
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

### Current State

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
| **Limitation of Floating Panels** | Floating panels stack and obstruct each other |
| **Basic Visual Design** | Panels lack modern styling, spacing, and visual hierarchy |
| **No Multi-Panel Management** | Cannot manage multiple open panels simultaneously |

---

## Decision Drivers

1. **Multi-Panel Support**: Enable multiple active plugins simultaneously (e.g., Draw + Measure + Layers)
2. **Floating Panel Management**: Better z-index and stacking management for overlapping panels
3. **Configuration-Driven**: Panel behavior defined in mission/tool configs, not hard-coded
4. **Gradual Migration**: Can adopt incrementally without rewriting all 16+ existing tools
5. **Incremental Enhancement**: Build foundation for future grid-based layout system

---

## Assumptions

1. **Panel Architecture Preservation**: Current panel system (left, bottom, floating) can be enhanced without fundamental rewrite
2. **Desktop-First**: Initial implementation focuses on desktop; mobile layout improvements are future work
3. **Backward Compatibility**: Existing tools continue working with current configuration until migrated
4. **Plugin Lifecycle Compatibility**: `make()` and `destroy()` functions can be minimally updated to support multi-panel scenarios (see [Tool Interface Changes](#tool-interface-changes))
5. **Grid Layout Deferred**: Full grid-based layout system (Gridstack.js) will be implemented in a later development cycle

---

## Considered Options

### Option 1: Enhanced Panel System (Selected)

**Description**: Extend current panel system with multi-panel support, modern controls, and improved visual design.


**Panel Features**:
- **Multi-Panel Support**: Multiple tools can be open simultaneously
- **Panel Controls**: Minimize, maximize, close buttons on panel header
- **Modern Styling**: Box shadows, border radius, proper spacing, visual hierarchy

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

### Option 2: Gridstack.js Grid System (Deferred to Future)

**Description**: Full grid-based layout with drag-and-drop positioning.

**Why deferred**:
- More complex than needed for current requirements
- Can be added later as enhancement to panel system
- Requires more extensive testing and migration effort

---

### Option 3: Complete UI Rewrite with React

**Description**: Modernize entire frontend with React framework.

**Why rejected**:
- Too disruptive for current development cycle
- Would require rewriting all 16+ existing tools
- Significant effort (months) with high risk
- Can be reconsidered in future major version

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
  
---

## Proposed Configuration Schema

### Tool Configuration

Tools will be configured with extended panel properties in the mission configuration:

```javascript
// Current Configuration (Backward Compatible)
{
  "name": "Draw",
  "icon": "vector-square",
  "js": "DrawTool",
  "separatedTool": false  // false = left/bottom panel, true = floating
}

// Proposed Enhanced Configuration
{
  "name": "Draw",
  "icon": "vector-square",
  "js": "DrawTool",
  "panel": {
    "type": "left",           // "left" | "right" | "top" | "bottom" | "floating"
    "defaultState": "open",   // "open" | "minimized" | "closed"
    "allowMinimize": true,    // Can user minimize this panel?
    "allowClose": true,       // Can user close this panel?
    "width": 300,             // Panel width (for left/floating panels)
    "height": 0,              // Panel height (0 = left panel, >0 = bottom panel)
    "justification": "left",  // "left" | "center" | "right" (for floating panels)
    "zIndex": 1005,           // Stacking order (for floating panels)
  }
}
```

**Backward Compatibility Mapping:**
```javascript
// Old format automatically converts to new format
{
  "separatedTool": true,
  "variables": { "justification": "right" }
}
// Becomes:
{
  "panel": {
    "type": "floating",
    "justification": "right",
    "defaultState": "open",
    "allowMinimize": true,
    "allowClose": true
  }
}
```
*Note: We may need to keep the old configuration for the backward compatibility*

### Panel State Management

PanelManager will track multiple active panels:

```javascript
// Current: Single active tool (ToolController_.js:18-19)
ToolController_ = {
  activeTool: null,
  activeToolName: null,
  // ...
}

// Proposed: Multiple active panels
PanelManager_ = {
  activePanels: {
    'DrawTool': {
      state: 'open',           // 'open' | 'minimized' | 'closed'
      instance: toolInstance,  // Reference to tool object
      containerId: 'toolContent_Draw',
      panelType: 'left',       // 'left' | 'bottom' | 'floating'
      priority: 1,             // Lower number = higher priority within same panelType
      zIndex: 1005
    },
    'MeasureTool': {
      state: 'minimized',
      instance: toolInstance,
      containerId: 'toolContentSeparated_Measure',
      panelType: 'floating',
      priority: 1,
      zIndex: 1006
    },
    'LayersTool': {
      state: 'open',
      instance: toolInstance,
      containerId: 'toolContent_Layers',
      panelType: 'bottom',
      priority: 2,
      zIndex: null
    }
  },
}
```

**Position conflicts**: When multiple tools are configured with the same `panelType` (e.g., two tools both set to `"left"`), their rendering order is determined by a `priority` value — lower numbers take precedence. This mirrors the existing priority mechanism MMGIS already uses for plugin ordering. In the current implementation, conflicts are resolved at runtime by `PanelManager_` based on this value. If two tools share the same `priority`, order falls back to the order in which they were registered.

> **Future work**: A formal validation step will be added when the tool builder UI is developed, allowing administrators to detect and resolve priority conflicts at configuration time rather than at runtime ensuring tools to be placed in expected position.

---

## Tool Lifecycle Changes

### Current Behavior (ToolController_.js:494-547)

**Problem**: Only one tool can be active at a time. Switching tools destroys the previous one.

```javascript
// Current: makeTool() in ToolController_.js
makeTool: function(name, idx) {
  var tool = this.getTool(name);

  if (this.activeToolName == null || name != this.activeToolName) {
    // Change tool
    if (this.activeTool != null) {
      this.activeTool.destroy();  // Destroys previous tool
    }

    this.activeTool = tool;
    this.activeTool.make(this);  // Make new tool
    this.activeToolName = name;
  } else {
    // Close tool (same tool clicked again)
    this.closeActiveTool();
  }
}
```

### Proposed Behavior

**Solution**: Track multiple active tools and manage visibility instead of destroying them.

```javascript
// Proposed: makeTool() with multi-panel support
makeTool: function(name, idx) {
  var tool = this.getTool(name);
  var toolConfig = this.tools[idx];

  // Check if tool is already active
  if (PanelManager_.isActive(name)) {
    // Toggle visibility or bring to front
    PanelManager_.togglePanel(name);
  } else {
    // Make new tool (first time opening)
    tool.make(this);

    // Register with PanelManager
    PanelManager_.registerPanel(name, {
      instance: tool,
      state: 'open',
      panelType: toolConfig.panel?.type || 'left',
      containerId: `toolContent_${toolConfig.name}`
    });

    // Notify tool it became visible
    if (typeof tool.notify === 'function') {
      tool.notify('visibility', { visible: true });
    }
  }
}
```

```javascript
// Close panel without destroying (unless user explicitly closes)
closePanel: function(toolName, permanent = false) {
  var panelState = PanelManager_.activePanels[toolName];

  if (permanent) {
    // User clicked close button - destroy the tool
    panelState.instance.destroy();
    delete PanelManager_.activePanels[toolName];
  } else {
    // Just hide the panel (minimize or switch tools)
    panelState.state = 'minimized';
    $(`#${panelState.containerId}`).hide();

    // Notify tool it became hidden
    if (typeof panelState.instance.notify === 'function') {
      panelState.instance.notify('visibility', { visible: false });
    }
  }
}
```

### Tool Interface Changes

**Key Insight**: Tool interfaces (`make()` and `destroy()`) do NOT need to change. We just manage when they're called differently.

**Current Tool Structure** (remains unchanged):
```javascript
// src/essence/Tools/ToolName/ToolName.js
const ToolName = {
  height: 0,
  width: 300,
  MMGISInterface: null,

  make: function() {
    // NO CHANGES NEEDED
    // Initialize tool UI and event handlers
    this.MMGISInterface = new interfaceWithMMGIS();
  },

  destroy: function() {
    // NO CHANGES NEEDED
    // Clean up event handlers and UI
    this.MMGISInterface.separateFromMMGIS();
  }
}
```

**Optional Enhancement**: Tools can implement `notify()` to handle visibility changes efficiently:

```javascript
const ToolName = {
  height: 0,
  width: 300,
  MMGISInterface: null,
  animationFrameId: null,

  make: function() {
    this.MMGISInterface = new interfaceWithMMGIS();
    this.startUpdates();
  },

  destroy: function() {
    this.stopUpdates();
    this.MMGISInterface.separateFromMMGIS();
  },

  // OPTIONAL: Handle visibility changes for performance
  notify: function(type, payload) {
    if (type === 'visibility') {
      if (payload.visible) {
        // Panel became visible - resume expensive operations
        this.startUpdates();
      } else {
        // Panel minimized/hidden - pause expensive operations
        this.stopUpdates();
      }
    }
  },

  startUpdates: function() {
    // Resume animation loops, data fetching, etc.
    if (!this.animationFrameId) {
      this.animationFrameId = requestAnimationFrame(this.update.bind(this));
    }
  },

  stopUpdates: function() {
    // Pause expensive operations when panel is hidden
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }
}
```

### Separated Tools (Floating Panels)

Separated tools already support multiple instances. (ToolController_.js:136-186)

```javascript
// Current: Separated tools already track multiple active instances
ToolController_ = {
  activeSeparatedTools: [],  // Already supports multiple!
  // ...
}

// Click handler for separated tools (already works correctly)
toolButton.on('click', function() {
  if (tM.made === false) {
    tM.make(`toolContentSeparated_${toolName}`);
    ToolController_.activeSeparatedTools.push(toolName);
  } else {
    tM.destroy();
    ToolController_.activeSeparatedTools =
      ToolController_.activeSeparatedTools.filter(a => a != toolName);
  }
});
```

**Proposed Enhancement**: Use separated tools with new panel management:

```javascript
// Unified panel management for all panel types
toolButton.on('click', function() {
  if (PanelManager_.isActive(toolName)) {
    // Close panel
    PanelManager_.closePanel(toolName, true);
  } else {
    // Open panel
    tM.make(`toolContentSeparated_${toolName}`);
    PanelManager_.registerPanel(toolName, {
      instance: tM,
      state: 'open',
      panelType: 'floating',
      containerId: `toolContentSeparated_${toolName}`
    });
  }
});
```

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

**Plugin Marketplace Integration**
- Sandboxed layout environments for third-party plugins
- Security validation and layout checks
