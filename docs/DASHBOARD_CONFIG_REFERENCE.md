# Dashboard Configuration Reference

Complete reference for configuring the modern dashboard mode in MMGIS.

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

The dashboard configuration controls the layout and behavior of panels in modern mode. It defines:
- Which panels exist and where they're positioned
- How panels behave (collapsible, resizable, etc.)
- Which tools go in which panels
- Panel sizes in different states

## Top-Level Configuration

```json
{
  "msv": {
    "mission": "MissionName",
    "mode": "modern"  // Required for modern layout
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

### 


**Note**: Tools specified in panel.tools arrays take precedence over .

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
  "tools": ["Tool1", "Tool2"]
}
```

### Core Panel Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | String | Yes | Unique identifier for this panel (e.g., "left-panel") |
| `title` | String | No | Display title for the panel |
| `position` | String | Yes | Panel position: `"top"`, `"left"`, `"right"`, `"bottom"` |
| `priority` | Number | Yes | Layout priority (lower = claims space first). Typically: top=0, left/right=1-2, bottom=3 |
| `layoutType` | String | Yes | How tools are arranged: `"stacked"` or `"tabbed"` |
| `stateConstraints` | Object | Yes | Defines allowed states and default state |
| `capabilities` | Object | No | Panel capabilities (orientation, resizing, max tools) |
| `dimensions` | Object | No | Size configuration for different states |
| `tools` | Array | No | Array of tool names to assign to this panel |
| `hasHeader` | Boolean | No | Whether panel has a header with title and control buttons |
| `overlay` | Boolean | No | Whether panel overlays map (default: true) or pushes it aside |

### position

Determines where the panel is located:

- **`"top"`**: Horizontal panel at the top
- **`"bottom"`**: Horizontal panel at the bottom
- **`"left"`**: Vertical panel on the left side
- **`"right"`**: Vertical panel on the right side

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

### tools

Array of tool names that should be assigned to this panel:

```json
{
  "tools": ["Layers", "Legend", "Info", "Sites"]
}
```

Tool names must match the `name` field in the mission's `tools` array.

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
      "tools": ["Layers", "Legend", "Info"]
    },
    {
      "id": "right-panel",
      "tools": ["Measure", "Draw"]
    }
  ]
}
```

### 2. Automatic Assignment (Fallback)

Unassigned tools are automatically placed in a compatible panel (prefers left position).

**Notes**:
- Tools with `on: false` in the tools array are skipped
- Tool compatibility is validated (orientation, position, capacity)
- Tools specified in panel.tools take precedence over 

## Complete Example

Full dashboard configuration with four panels:

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
        "tools": ["Animation"]
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
        "tools": ["Layers", "Legend", "Info"]
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
        "tools": ["Measure", "Chart", "PointCloud"]
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
        "tools": ["Draw", "RasterTile", "Identifier"]
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