# Mission Configuration Reference

Complete reference for configuring the modern interface in MMGIS.

## Table of Contents

- [Overview](#overview)
- [Top-Level Configuration](#top-level-configuration)
- [Panel Settings Structure](#panel-settings-structure)
- [Panel Configuration](#panel-configuration)
- [State Constraints](#state-constraints)
- [Panel Capabilities](#panel-capabilities)
- [Panel Dimensions](#panel-dimensions)
- [Tool Assignment](#tool-assignment)
- [Complete Example](#complete-example)

## Overview

The mission configuration controls the layout and behavior of panels in modern interface mode. It defines:
- Which panels exist and where they're positioned
- How panels behave (collapsible, resizable, etc.)
- Which tools go in which panels
- Panel sizes in different states

## Top-Level Configuration

```json
{
  "msv": {
    "mission": "MissionName",
    "mode": "modern"  // Required for modern interface
  },
  "panelSettings": {
    // Panel configuration goes here
  },
  "tools": [
    // Tool definitions
  ]
}
```

### Required Fields

- **`msv.mode`**: Must be set to `"modern"` to enable modern layout
- **`panelSettings.panels`**: Array of panel configurations (at least one panel required)

## Panel Settings Structure

```json
{
  "panelSettings": {
    "layoutStyle": "compact",
    "panels": [
      // Array of panel configurations
    ],
    "": {
      // Optional: Map tool names/IDs to panel IDs
    }
  }
}
```

### panelSettings Object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `layoutStyle` | String | No | `"overlay"` (default) or `"compact"` layout style |
| `panels` | Array | Yes | Array of panel configuration objects |

## Panel Configuration

Each panel in the `panels` array must include these fields:

```json
{
  "id": "panel-id",
  "position": "left",
  "priority": 0,
  "layoutType": "stacked",
  "stateConstraints": { /* ... */ },
  "capabilities": { /* ... */ },
  "dimensions": { /* ... */ },
  "panelTools": ["Tool1", "Tool2"]
}
```

### Core Panel Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | String | Yes | Unique identifier for this panel (e.g., "left-panel") |
| `title` | String | No | Display title for the panel |
| `position` | String | Yes | Panel position: `"top"`, `"left"`, `"right"`, `"bottom"` |
| `priority` | Number | Yes | Panel priority (lower = claims space first). Typically: top=0, left/right=1-2, bottom=3 |
| `layoutType` | String | Yes | How tools are arranged: `"stacked"` or `"tabbed"` |
| `stateConstraints` | Object | Yes | Defines allowed states and default state |
| `capabilities` | Object | No | Panel capabilities (orientation, resizing, max tools) |
| `dimensions` | Object | No | Size configuration for different states |
| `panelTools` | Array | No | Array of tool names to assign to this panel's scrolling body |
| `pinnedTools` | Array | No | Tool names to hold in the panel's pinned region, above the scrolling body. Left/right panels only |
| `hasHeader` | Boolean | No | Whether panel has a header with title and control buttons |
| `overlay` | Boolean | No | Whether panel overlays map (default: true) or pushes it aside |

### position

Determines where the panel is located:

- **`"top"`**: Horizontal panel at the top
- **`"bottom"`**: Horizontal panel at the bottom
- **`"left"`**: Vertical panel on the left side
- **`"right"`**: Vertical panel on the right side

**Floating positions** (render inside the center map area as overlays):

- **`"float-top-left"`**: Floats in the top-left corner of the map
- **`"float-top-center"`**: Floats at the top-center of the map
- **`"float-top-right"`**: Floats in the top-right corner of the map
- **`"float-bottom-left"`**: Floats in the bottom-left corner of the map
- **`"float-bottom-center"`**: Floats at the bottom-center of the map
- **`"float-bottom-right"`**: Floats in the bottom-right corner of the map

**Floating panel rules**:
- Multiple tools can be assigned to one floating panel — each tool renders as its own card with a gap between cards
- Only **one** floating panel is allowed per position — the validator rejects configs that assign more than one panel (in `panels` or `floatingPanels`) to the same float position
- Supported states: `"collapsed"` and `"expanded"` only (`"iconified"` and `"focused"` are not supported)
- `layoutType` is ignored for floating panels
- `capabilities.resizable` is not supported for floating panels
- In `overlay` layout style the panel has rounded corners; in `compact` layout style it has sharp corners
- A gap between cards is applied automatically; no outer gap is added in overlay mode (the panel's own margin handles it)

**Floating panel `dimensions` fields**:

All values accept any CSS unit string (e.g. `"40%"`, `"50vh"`, `"300px"`) or a plain number (treated as `px`). Dimensions apply to each individual tool card.

| Field | Description |
|---|---|
| `defaultWidth` | Initial width (omit to size to content) |
| `defaultHeight` | Initial height (omit to size to content) |
| `minWidth` | Minimum width |
| `maxWidth` | Maximum width |
| `minHeight` | Minimum height |
| `maxHeight` | Maximum height — useful for capping top/bottom float zones so they never overlap (e.g. top panel `maxHeight: "40%"`, bottom panel `maxHeight: "50%"` leaves a 10% gap) |

### priority

Controls the order in which panels claim viewport space:

- **Lower numbers** = higher priority (claim space first)
- **Typical values**:
  - `0` - Top panel (full width)
  - `1` - Left panel (full height minus top)
  - `2` - Right panel (full height minus top)
  - `3` - Bottom panel (remaining width)

### layoutType

Determines how multiple tools are displayed when panel is expanded:

- **`"stacked"`**: All tools visible simultaneously, stacked vertically/horizontally
- **`"tabbed"`**: Tools in tabs, only active tool's content visible

### panelTools

Array of tool names that should be assigned to this panel's scrolling body:

```json
{
  "panelTools": ["Layers", "Legend", "Info", "Sites"]
}
```

Tool names must match the `name` field in the mission's `tools` array.

### pinnedTools

Tool names that belong in the panel's **pinned region** — a block at the top of
the panel that holds its place while everything below it scrolls:

```json
{
  "pinnedTools": ["MapControl"],
  "panelTools": ["Layers", "Legend", "Info"]
}
```

Pinned tools render above the panel body, in the order listed, and the panel's
scrollbar starts below them. A panel that pins nothing looks and behaves exactly
as one without the field — no reserved space, no extra chrome.

Notes:

- Only left and right panels have a pinned region. Naming pinned tools on a
  top, bottom or floating panel places them in the panel body instead, with a
  console warning.
- In a `"tabbed"` panel the pinned region sits above the tab bar, so pinned
  tools stay visible while switching tabs.
- A tool belongs to one list or the other. A name in both stays pinned.
- Pinned tools are still tools in the panel: they count towards
  `capabilities.maxTools` and appear in the iconified icon bar.
- The region is sized by its content up to 60% of the panel; past that it
  scrolls on its own rather than crowding out the panel body.

## State Constraints

Defines which states a panel can transition between and the initial state.

```json
{
  "stateConstraints": {
    "allowedStates": ["collapsed", "iconified", "focused", "expanded"],
    "defaultState": "iconified"
  }
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `allowedStates` | Array | Yes | Array of permitted states for this panel |
| `defaultState` | String | Yes | Initial state when panel is created |

### Panel States

- **`"collapsed"`**: Hidden completely, takes no viewport space
- **`"iconified"`**: Shows only tool icons in a compact toolbar
- **`"focused"`**: Single tool visible (user clicked an icon from iconified state)
- **`"expanded"`**: All tools visible in configured layout (stacked/tabbed)

### Common State Combinations

**Top/Bottom Panels** (typically horizontal toolbars):
```json
{
  "allowedStates": ["collapsed", "expanded"],
  "defaultState": "collapsed"
}
```

**Side Panels** (full feature panels with iconification):
```json
{
  "allowedStates": ["collapsed", "iconified", "focused", "expanded"],
  "defaultState": "iconified"
}
```

**Side Panels** (simple show/hide):
```json
{
  "allowedStates": ["collapsed", "expanded"],
  "defaultState": "expanded"
}
```

## Panel Capabilities

Defines what the panel supports (orientation, resizing, capacity).

```json
{
  "capabilities": {
    "supportedOrientation": "vertical",
    "resizable": true,
    "maxTools": 5,
    "minSize": 200,
    "maxSize": 600
  }
}
```

### Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `supportedOrientation` | String | No | Tool orientation: `"horizontal"`, `"vertical"`, or `"any"` |
| `resizable` | Boolean | No | Whether user can drag-resize the panel (default: false) |
| `maxTools` | Number | No | Maximum number of tools allowed (undefined = no limit) |
| `minSize` | Number | No | Minimum size in pixels when resizing (requires resizable: true) |
| `maxSize` | Number | No | Maximum size in pixels when resizing (requires resizable: true) |

### supportedOrientation

Validates tool compatibility based on required orientation:

- **`"horizontal"`**: Only accepts tools requiring horizontal layout (top/bottom panels)
- **`"vertical"`**: Only accepts tools requiring vertical layout (left/right panels)
- **`"any"`**: Accepts all tools regardless of orientation

**Recommendation**: Match orientation to position:
- Top/bottom panels → `"horizontal"`
- Left/right panels → `"vertical"` or `"any"`

### resizable

If `true`, users can drag a handle to resize the panel. Respects `minSize` and `maxSize` constraints.

### maxTools

Limits the number of tools that can be assigned to the panel. Useful for:
- Preventing UI clutter
- Ensuring critical tools always fit
- Enforcing UX design constraints

## Panel Dimensions

Specifies panel sizes for different states.

```json
{
  "dimensions": {
    "iconifiedSize": 50,
    "focusedWidth": 300,
    "focusedHeight": 200,
    "expandedSize": 400
  }
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `iconifiedSize` | Number | Size of icon bar when in `iconified` state (pixels) |
| `focusedWidth` | Number or `"content"` | Width when in `focused` state (vertical panels) |
| `focusedHeight` | Number or `"content"` | Height when in `focused` state (horizontal panels) |
| `expandedSize` | Number, `"content"`, or Object | Size when in `expanded` state |

### Size Values

- **Number**: Fixed size in pixels (e.g., `300`)
- **`"content"`**: Size based on content (grows to fit)
- **Object**: Content-based with constraints: `{ "min": 200, "max": 500 }`

### Size Interpretation by Position

**Left/Right Panels** (vertical):
- `iconifiedSize` → width of icon bar
- `focusedWidth` → width when single tool is open
- `expandedSize` → width when all tools visible

**Top/Bottom Panels** (horizontal):
- `iconifiedSize` → height of icon bar
- `focusedHeight` → height when single tool is open
- `expandedSize` → height when all tools visible

### Common Dimension Patterns

**Left/Right Panel with Iconification**:
```json
{
  "dimensions": {
    "iconifiedSize": 50,
    "focusedWidth": 300,
    "expandedSize": 400
  }
}
```

**Top Panel (no iconification)**:
```json
{
  "dimensions": {
    "expandedSize": 60
  }
}
```

**Bottom Panel with Flexible Sizing**:
```json
{
  "dimensions": {
    "expandedSize": {
      "min": 200,
      "max": 500
    }
  }
}
```

## Tool Assignment
### 1. Panel.tools Array

Specify tools directly in each panel configuration:

```json
{
  "panels": [
    {
      "id": "left-panel",
      "panelTools": ["Layers", "Legend", "Info"]
    },
    {
      "id": "right-panel",
      "panelTools": ["Measure", "Draw"]
    }
  ]
}
```

Tools listed in a panel's `pinnedTools` are assigned first, so the pinned
region keeps its configured order.

### 2. Automatic Assignment (Fallback)

Unassigned tools are automatically placed in a compatible panel (prefers left position).

**Notes**:
- Tools with `on: false` in the tools array are skipped
- Tool compatibility is validated (orientation, position, capacity)
- Tools specified in panel.tools take precedence over 

## Complete Example

Full mission configuration with four panels:

```json
{
  "msv": {
    "mission": "AirQuality Visualization",
    "mode": "modern"
  },
  "panelSettings": {
    "panels": [
      {
        "id": "top-panel",
        "position": "top",
        "priority": 0,
        "layoutType": "stacked",
        "stateConstraints": {
          "allowedStates": ["collapsed", "expanded"],
          "defaultState": "collapsed"
        },
        "capabilities": {
          "supportedOrientation": "horizontal",
          "resizable": false
        },
        "dimensions": {
          "expandedSize": 60
        },
        "panelTools": ["Animation"]
      },
      {
        "id": "left-panel",
        "position": "left",
        "priority": 1,
        "layoutType": "tabbed",
        "stateConstraints": {
          "allowedStates": ["collapsed", "iconified", "focused", "expanded"],
          "defaultState": "iconified"
        },
        "capabilities": {
          "supportedOrientation": "vertical",
          "resizable": true,
          "minSize": 100,
          "maxSize": 600
        },
        "dimensions": {
          "iconifiedSize": 50,
          "focusedWidth": 300,
          "expandedSize": 400
        },
        "panelTools": ["Layers", "Legend", "Info"]
      },
      {
        "id": "right-panel",
        "position": "right",
        "priority": 2,
        "layoutType": "tabbed",
        "stateConstraints": {
          "allowedStates": ["collapsed", "iconified", "focused", "expanded"],
          "defaultState": "iconified"
        },
        "capabilities": {
          "supportedOrientation": "vertical",
          "resizable": true,
          "minSize": 100,
          "maxSize": 600
        },
        "dimensions": {
          "iconifiedSize": 50,
          "focusedWidth": 300,
          "expandedSize": 400
        },
        "panelTools": ["Measure", "Chart", "PointCloud"]
      },
      {
        "id": "bottom-panel",
        "position": "bottom",
        "priority": 3,
        "layoutType": "tabbed",
        "stateConstraints": {
          "allowedStates": ["collapsed", "iconified", "focused", "expanded"],
          "defaultState": "collapsed"
        },
        "capabilities": {
          "supportedOrientation": "horizontal",
          "resizable": true,
          "minSize": 100,
          "maxSize": 400
        },
        "dimensions": {
          "iconifiedSize": 50,
          "focusedHeight": 200,
          "expandedSize": 300
        },
        "panelTools": ["Draw", "RasterTile", "Identifier"]
      },
      {
        "id": "timeline-panel",
        "position": "float-bottom-center",
        "priority": 0,
        "layoutType": "stacked",
        "stateConstraints": {
          "allowedStates": ["collapsed", "expanded"],
          "defaultState": "expanded"
        },
        "panelTools": ["Timeline"]
      },
      {
        "id": "legend-float-panel",
        "position": "float-bottom-right",
        "priority": 0,
        "layoutType": "stacked",
        "stateConstraints": {
          "allowedStates": ["collapsed", "expanded"],
          "defaultState": "expanded"
        },
        "panelTools": ["Legend"]
      }
    ]
  },
  "tools": [
    {
      "name": "Layers",
      "icon": "layers",
      "js": "LayersTool"
    },
    {
      "name": "Legend",
      "icon": "format-list-bulleted-type",
      "js": "LegendTool",
      "separatedTool": true,
      "variables": {
        "displayOnStart": true,
        "justification": "right"
      }
    },
    {
      "name": "Info",
      "icon": "information-variant",
      "js": "InfoTool"
    },
    {
      "on": true,
      "name": "Animation",
      "icon": "video",
      "js": "AnimationTool"
    },
    {
      "on": true,
      "name": "Measure",
      "icon": "tape-measure",
      "js": "MeasureTool"
    },
    {
      "on": false,
      "name": "Chart",
      "icon": "chart-areaspline",
      "js": "ChartTool"
    },
    {
      "on": true,
      "name": "Draw",
      "icon": "pencil",
      "js": "DrawTool"
    },
    {
      "on": true,
      "name": "RasterTile",
      "icon": "cloud-search",
      "js": "RasterTile"
    },
    {
      "on": true,
      "name": "Identifier",
      "icon": "map-marker",
      "js": "IdentifierTool",
      "separatedTool": true
    }
  ]
}
```