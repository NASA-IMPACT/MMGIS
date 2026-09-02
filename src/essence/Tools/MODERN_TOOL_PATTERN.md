# Modern Tool Pattern Guide

## Overview

This guide explains how to create MMGIS tools compatible with the **modern layout system**. Modern tools support flexible placement in custom layouts (dashboard mode, panels, etc.) through the `targetId` pattern.

**Modern tools enable**:
- Dynamic placement in any DOM container
- Cleaner lifecycle management
- Dashboard and custom panel layouts

---

## Tool Architecture Types

### 1. **Legacy jQuery Tools** (Classic Layout)
- Hardcoded to render in `#toolPanel`
- No `targetId` support
- Global event handlers

### 3. **Modern React Tools** (Modern Layout)
- Supports dynamic `targetId` placement
- Uses React for rendering
- Component-based architecture
- Built-in cleanup and lifecycle

---

## Modern React Tool Pattern (Recommended)

For new tools, use React with TypeScript/JSX:

### Core Structure

```typescript
import React from 'react'
import { createRoot, Root } from 'react-dom/client'

let _root: Root | null = null

const MyTool = {
    height: 0,
    width: 300,
    targetId: null as string | null,
    made: false,

    make: function (targetId?: string) {
        this.targetId = typeof targetId === 'string' ? targetId : 'toolPanel'
        const container = document.getElementById(this.targetId)

        if (!container) {
            console.error(`MyTool: container ${this.targetId} not found`)
            return
        }

        _root = createRoot(container)
        _root.render(<MyToolComponent />)
        this.made = true
    },

    destroy: function () {
        if (_root) {
            _root.unmount()
            _root = null
        }
        this.targetId = null
        this.made = false
    },

    getUrlString: function () {
        return ''
    }
}

export default MyTool
```

---

## Modern jQuery Tool Pattern

If your tool is simple and doesn't need React, use this jQuery pattern:

### 4-Step Checklist

#### 1. Add Core State Properties

```javascript
const MyTool = {
    targetId: null,      // Stores the target DOM container ID
    made: false,         // Tracks initialization state
    // ... existing properties
}
```

#### 2. Update `make()` to Accept `targetId`

```javascript
make: function (targetId) {
    this.targetId = typeof targetId === 'string' ? targetId : 'toolPanel'
    this.MMGISInterface = new interfaceWithMMGIS()
    this.made = true
}
```

#### 3. Use Dynamic DOM Targeting

**IMPORTANT**: All DOM operations must use `this.targetId`, not hardcoded `#toolPanel`:

```javascript
function interfaceWithMMGIS() {
    // 1. Get the target container
    const tools = $(`#${MyTool.targetId}`)

    // 2. Render your markup
    tools.html(markup)

    // 3. Attach event handlers scoped to this container
    // This ensures they're cleaned up when the tool is destroyed
    tools.find('.myTool-button').on('click', function() {
        // Handle click
    })
}
```

**Why scope events to the container?**
- Prevents memory leaks when tool is destroyed
- Allows multiple instances without conflicts
- Makes cleanup simple: `tools.off()` removes all handlers

#### 4. Clean Up in `destroy()`

```javascript
destroy: function () {
    this.MMGISInterface.separateFromMMGIS()
    this.targetId = null
    this.made = false
}

// Inside interfaceWithMMGIS:
function separateFromMMGIS() {
    const tools = $(`#${MyTool.targetId}`)
    tools.off()     // Remove all event listeners
    tools.empty()   // Clear DOM content
}
```

---

## Configuration (`config.json`)

Declare the tool's `id` in its `config.json`, and add a `metadata` object if it needs specific placement options:

```json
{
  "name": "MyTool",
  "id": "my-tool",
  "description": "Short description of what this tool does",
  "defaultIcon": "clock-outline",
  "paths": {
    "MyTool": "essence/Tools/MyTool/MyTool"
  },
  "metadata": {
    "icon": "clock-outline",
    "requiredOrientation": "any",
    "compatiblePositions": ["top", "bottom", "left", "right"],
    "preferredPosition": "top",
    "modernLayoutSupport": true
  }
}
```

`id` must match `/^[a-z][a-z0-9-]*$/` and be unique across tools; the build refuses to generate the tool registry otherwise. It is the tool's identity everywhere but the import: the key under which its configured `variables` resolve, the target `plugins:show:my-tool` takes, the prefix on the bus handle the controller injects as `this.api` (`plugin:my-tool:ready`), and the `pluginId` its teardown announces. The `paths` key beside it names the generated import binding and nothing else.
