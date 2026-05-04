# Modern Tool Pattern Guide

## Overview

This guide explains how to create MMGIS tools compatible with the **modern layout system**. Modern tools support flexible placement in custom layouts (dashboard mode, panels, etc.) through the `targetId` pattern.

**Modern tools enable**:
- Dynamic placement in any DOM container
- Multiple instances of the same tool
- Cleaner lifecycle management
- Dashboard and custom panel layouts

---

## 4-Step Checklist for Modern Tools

Follow these steps to make your tool compatible with modern layouts:

### 1. Add Core State Properties
Add `targetId` and `made` to your tool object to track its instance state:

```javascript
const MyTool = {
    targetId: null,      // Stores the target DOM container ID
    made: false,         // Tracks initialization state
    // ... existing properties
}
```

### 2. Update `make()` to Accept `targetId`
Modify the `make()` method to accept and store the `targetId` parameter, providing a fallback:

```javascript
make: function (targetId) {
    this.targetId = typeof targetId === 'string' 
        ? targetId 
        : '__MyTool_missing_targetId'
    
    this.MMGISInterface = new interfaceWithMMGIS()
    this.made = true
}
```

### 3. Use Dynamic DOM Targeting and Scoping
Replace hardcoded selectors (like `#toolPanel` or `#tools`) with the dynamic `targetId`. Ensure all DOM operations and event listeners are scoped to this container to prevent conflicts with other instances.

```javascript
function interfaceWithMMGIS() {
    // 1. Target the specific container
    const containerId = MyTool.targetId ? `#${MyTool.targetId}` : '#toolPanel'
    const tools = $(containerId)
    
    // 2. Render content
    tools.css('background', 'var(--color-k)')
    tools.html('<div style="height: 100%">' + markup + '</div>')
    
    // 3. Scope event handlers using .find() or event delegation on 'tools'
    tools.find('.myTool-button').on('click', function() { ... })
    // OR
    tools.on('click', '.myTool-button', function() { ... })
}
```

### 4. Clean Up in `destroy()`
Ensure you clean up the container, remove event listeners, and reset the state:

```javascript
destroy: function () {
    // Clean up DOM and events
    this.MMGISInterface.separateFromMMGIS()
    
    // Reset state
    this.targetId = null
    this.made = false
}

// Inside interfaceWithMMGIS:
function separateFromMMGIS() {
    const containerId = MyTool.targetId ? `#${MyTool.targetId}` : '#toolPanel'
    const tools = $(containerId)
    
    tools.off()     // Remove event listeners
    tools.empty()   // Clear DOM
}
```

---

## Configuration (`config.json`)

If your tool requires specific placement options, add a `metadata` object to your tool's `config.json`:

```json
{
  "name": "MyTool",
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
