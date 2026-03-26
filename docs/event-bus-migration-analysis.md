# Event Bus Migration Analysis - Comprehensive Codebase Analysis

**Purpose**: Comprehensive analysis of all direct calls in MMGIS Tools and Basics modules that could be migrated to the event bus pattern

---

## Table of Contents

### Tools Analysis (src/essence/Tools)
1. [AnimationTool](#1-animationtool)
2. [ChemistryTool](#2-chemistrytool)
3. [CurtainTool](#3-curtaintool)
4. [DrawTool](#4-drawtool)
5. [IdentifierTool](#5-identifiertool)
6. [InfoTool](#6-infotool)
7. [IsochroneTool](#7-isochronetool)
8. [KindsTool](#8-kindstool)
9. [LayersTool](#9-layerstool)
10. [LegendTool](#10-legendtool)
11. [MeasureTool](#11-measuretool)
12. [ShadeTool](#12-shadetool)
13. [SitesTool](#13-sitestool)
14. [ViewshedTool](#14-viewshedtool)
15. [Summary Statistics (Tools)](#15-summary-statistics)
16. [Migration Priority](#16-migration-priority)

### Basics Analysis (src/essence/Basics)
17. [Core Basics Modules Analysis](#17-core-basics-modules-analysis)
    - [ComponentController_](#componentcontroller_)
    - [Formulae_](#formulae_)
    - [Globe_](#globe_)
    - [Layers_](#layers_)
    - [MapEngines](#mapengines)
    - [Map_](#map_)
    - [Test_](#test_)
    - [TimeControl_](#timecontrol_)
    - [ToolController_](#toolcontroller_)
    - [UserInterface_](#userinterface_)
    - [Viewer_](#viewer_)
18. [Updated Summary Statistics (Combined)](#18-updated-summary-statistics)
19. [New Events Needed (Emitter Side - Basics)](#19-new-events-needed-emitter-side---basics)

---

## Pattern Categories

| Category | Description | Migration Target |
|----------|-------------|------------------|
| **Map_.map.*** | Direct Leaflet map method calls | `mmgisAPI.request('map:*')` providers |
| **Globe_.litho.*** | Direct LithoSphere (3D) calls | `mmgisAPI.request('globe:*')` providers |
| **L_.subscribe*** | Legacy event subscriptions | `mmgisAPI.on('event:name')` |
| **L_.unsubscribe*** | Legacy event unsubscriptions | Store & call unsubscribe function |
| **CustomEvent** | Legacy DOM event dispatch | `mmgisAPI.emit('event:name')` (dual-emit) |
| **document.addEventListener** | Legacy DOM event listeners | `mmgisAPI.on('event:name')` |
| **ToolController_.getTool()** | Direct tool access | `mmgisAPI.request('plugin:tool:method')` |
| **Map_.activeLayer** | Direct active layer access | Subscribe to `feature:active` event |
| **L_.missionPath** | Direct mission path access | `mmgisAPI.request('app:getMissionPath')` |

---

## 1. AnimationTool

**Files**: `src/essence/Tools/Animation/AnimationTool.js`, `OffscreenMapManager.js`

### Map_.map.* Direct Calls

| Line | File | Pattern | Category |
|------|------|---------|----------|
| 758 | AnimationTool.js | `Map_.map.on('projectionchange', ...)` | Event listener |
| 768 | AnimationTool.js | `Map_.map.on('zoomend', ...)` | Event listener |
| 778-781 | AnimationTool.js | `Map_.map.latLngToContainerPoint(...)` | Projection |
| 899 | AnimationTool.js | `Map_.map.removeLayer(...)` | Layer management |
| 903 | AnimationTool.js | `L.layerGroup().addTo(Map_.map)` | Layer management |
| 923, 1139 | AnimationTool.js | `const map = Map_.map` | Map reference |
| 1205 | AnimationTool.js | `...addTo(Map_.map)` | Layer management |
| 1210 | AnimationTool.js | `Map_.map.removeControl(...)` | Control management |
| 1218 | AnimationTool.js | `Map_.map.getBounds()` | **Migratable** |
| 1227-1230 | AnimationTool.js | `Map_.map.latLngToContainerPoint(...)` | Projection |
| 1307, 2863, 2904 | AnimationTool.js | `Map_.map.removeLayer(...)` | Layer management |
| 1386-1392 | AnimationTool.js | `Map_.map.containerPointToLatLng(...)` | Projection |
| 1537 | AnimationTool.js | `Map_.map` (reference) | Map reference |
| 1613, 1656, 1675, 1718, 1743 | AnimationTool.js | Layer add/remove operations | Layer management |

### DOM Event Listeners

| Line | Pattern | Notes |
|------|---------|-------|
| 1133 | `document.addEventListener('keydown', onEscape)` | Standard DOM (keep) |

**Analysis**: AnimationTool has ~25 Map_.map calls. Most are projection/layer management that need direct map access. `getBounds()` is migratable. Event listeners are internal to the tool's drawing mode.

---

## 2. ChemistryTool

**Files**: `src/essence/Tools/Chemistry/ChemistryTool.js`

**No direct calls found.** This tool is clean and doesn't need migration.

---

## 3. CurtainTool

**Files**: `src/essence/Tools/Curtain/CurtainTool.js`

### Map_.* Direct Calls

| Line | Pattern | Category |
|------|---------|----------|
| 523, 668 | `Map_.rmNotNull(...)` | Utility (keep) |
| 676 | `.addTo(Map_.map)` | Layer management |

### Globe_.litho.* Direct Calls

| Line | Pattern | Category |
|------|---------|----------|
| 309 | `Globe_.litho.hasLayer(id)` | Layer query |
| 309 | `Globe_.litho.removeLayer(id)` | Layer management |
| 467, 488 | `Globe_.litho.removeLayer(imgId)` | Layer management |
| 692 | `Globe_.litho.setLayerSpecificOptions(...)` | Layer options |
| 716 | `Globe_.litho.hasLayer(...)` | Layer query |
| 719, 773, 807 | `Globe_.litho.addLayer(...)` | Layer management |
| 843, 845 | `Globe_.litho.removeLayer(...)` | Layer management |

**Analysis**: CurtainTool has ~10 Globe_.litho calls for 3D layer management. Consider `globe:addLayer`, `globe:removeLayer`, `globe:hasLayer` providers.

---

## 4. DrawTool

**Files**: `src/essence/Tools/Draw/DrawTool.js`, `DrawTool_Files.js`, `DrawTool_Shapes.js`, `DrawTool_Drawing.js`, `DrawTool_Editing.js`, `DrawTool_Templater.js`

### L_.subscribe* / L_.unsubscribe* Methods

| Line | File | Old Pattern | New Pattern |
|------|------|-------------|-------------|
| 1779 | DrawTool.js | `L_.subscribeTimeChange('DrawTool', ...)` | `mmgisAPI.on('time:change', ...)` |
| 1784 | DrawTool.js | `L_.subscribeOnTimeUIToggle('DrawTool', ...)` | `mmgisAPI.on('time:toggleUI', ...)` |
| 2197 | DrawTool.js | `L_.unsubscribeTimeChange('DrawTool')` | Call stored unsubscribe function |
| 2198 | DrawTool.js | `L_.unsubscribeOnTimeUIToggle('DrawTool')` | Call stored unsubscribe function |

### Map_.map.* Direct Calls (Selected - High Priority)

| Line | File | Pattern | Migratable? |
|------|------|---------|-------------|
| 2273 | DrawTool_Files.js | `Map_.map.getBounds()` | **Yes** → `map:getBounds` |
| 2274 | DrawTool_Files.js | `Map_.map.getZoom()` | **Yes** → `map:getZoom` |
| 2275 | DrawTool_Files.js | `Map_.map.getCenter()` | **Yes** → `map:getCenter` |
| 2598 | DrawTool_Files.js | `Map_.map.fitBounds(...)` | **Yes** → `map:fitBounds` |
| 2599 | DrawTool_Files.js | `Map_.map.panTo(...)` | **Yes** → `map:panTo` |
| 799, 801, 811 | DrawTool_Shapes.js | `Map_.map.panTo(...)` | **Yes** → `map:panTo` |
| 1379, 1381 | DrawTool_Shapes.js | `Map_.map.panTo(...)` | **Yes** → `map:panTo` |
| 1413 | DrawTool_Shapes.js | `Map_.map.fitBounds(...)` | **Yes** → `map:fitBounds` |
| 1645-1646 | DrawTool_Drawing.js | `Map_.map.fitBounds/panTo(...)` | **Yes** |
| 924 | DrawTool_Editing.js | `Map_.map.getZoom()` | **Yes** → `map:getZoom` |

### Map_.map.* Event Listeners (Internal - Keep)

| Line | File | Pattern |
|------|------|---------|
| 746-747, 984-985 | DrawTool.js | `Map_.map.on/off('moveend/zoomend', ...)` |
| 129-130 | DrawTool_Shapes.js | `Map_.map.on('mousemove.drawToolTooltip', ...)` |
| 435-700+ | DrawTool_Drawing.js | Various drawing mode events |
| 968, 1123 | DrawTool_Templater.js | `Map_.map.on/off('draw:created', ...)` |
| 3046-3081 | DrawTool_Editing.js | Editing mode events |

### Map_.activeLayer Access

| Line | File | Pattern |
|------|------|---------|
| 737-750 | DrawTool_Shapes.js | `if (Map_.activeLayer) {...}` |
| 778 | DrawTool_Shapes.js | `if (Map_.activeLayer === l[i])` |
| 837-840 | DrawTool.js | `Map_.activeLayer = layer` (setting) |
| 1659-1703 | DrawTool_Files.js | Multiple `Map_.activeLayer` checks |

### Globe_.* Direct Calls

| Line | File | Pattern |
|------|------|---------|
| 852-853 | DrawTool.js | `Globe_.highlight()`, `Globe_.findSpriteObject()` |
| 1577, 2005, 2145, 2467 | DrawTool_Files.js | `Globe_.litho.removeLayer/addLayer(...)` |
| 1308 | DrawTool_Editing.js | `Globe_.litho.removeLayer(...)` |

**Total DrawTool migrations**: ~40+ instances (12 high-priority Map calls, 4 L_.subscribe patterns, 6 Map_.activeLayer patterns, 7 Globe calls)

---

## 5. IdentifierTool

**Files**: `src/essence/Tools/Identifier/IdentifierTool.js`

### L_.subscribe* / L_.unsubscribe* Methods

| Line | Old Pattern | New Pattern | Notes |
|------|-------------|-------------|-------|
| 43-45 | `L_.subscribeOnLayerToggle('IdentifierTool', ...)` | `mmgisAPI.on('layer:visibilityChange', ...)` | |
| 49-51 | `L_.subscribeOnLayerToggle('IdentifierTool', ...)` | **DELETE** | ⚠️ BUG: Duplicate subscription |
| 100 | `L_.unsubscribeOnLayerToggle('IdentifierTool')` | Call stored unsubscribe | |

### Map_.map.* Direct Calls

| Line | Pattern | Migratable? |
|------|---------|-------------|
| 156 | `Map_.map.getZoom()` | **Yes** → `map:getZoom` |
| 583-584, 610-611 | `Map_.map.on/off('mousemove/mouseout', ...)` | Internal (keep) |

### Globe_.litho.* Direct Calls

| Line | Pattern | New Provider Needed |
|------|---------|---------------------|
| 161 | `Globe_.litho.mouse` check | `globe:getMouse` |
| 163-165 | `Globe_.litho.mouse.lng/lat`, `Globe_.litho.zoom` | `globe:getMouse`, `globe:getZoom` |
| 586-591, 615-618 | `Globe_.litho.getContainer().addEventListener/removeEventListener(...)` | Keep (DOM events) |
| 594, 614 | `Globe_.litho.getContainer().style.cursor` | Keep (style manipulation) |

**Bugs Found**:
1. **Line 49-51**: Duplicate subscription (exact copy of lines 43-45)
2. **Line 618**: Wrong event type - removes 'mousemove' instead of 'mouseout' → **Memory leak**

---

## 6. InfoTool

**Files**: `src/essence/Tools/Info/InfoTool.js`

### Map_.map.* Direct Calls

| Line | Pattern | Migratable? |
|------|---------|-------------|
| 330 | `Map_.map.fitBounds(InfoTool.currentLayer.getBounds())` | **Yes** → `map:fitBounds` |
| 331 | `Map_.map.panTo(InfoTool.currentLayer._latlng)` | **Yes** → `map:panTo` |

### DOM Event Listeners

| Line | Pattern | Notes |
|------|---------|-------|
| 778 | `document.addEventListener('keydown', InfoTool.hotKeyEvents)` | Standard DOM (keep) |
| 783 | `document.removeEventListener('keydown', InfoTool.hotKeyEvents)` | Standard DOM (keep) |

**Note**: The keydown listener is for hotkey support, not a custom event pattern. Keep as-is.

---

## 7. IsochroneTool

**Files**: `src/essence/Tools/Isochrone/IsochroneTool.js`, `IsochroneTool_Query.js`, `IsochroneTool_Manager.js`, `IsochroneTool_Algorithm.js`

### Map_.map.* Direct Calls

| Line | File | Pattern | Category |
|------|------|---------|----------|
| 21 | IsochroneTool_Query.js | `Map_.map.getPixelWorldBounds(tile.z)` | Projection |
| 302-303, 310, 329, 350 | IsochroneTool_Manager.js | `Map_.map.project/unproject(...)` | Projection |
| 403-404 | IsochroneTool.js | `Map_.map.getMinZoom/getMaxZoom()` | **Migratable** |
| 417 | IsochroneTool.js | `Map_.map.addLayer(...)` | Layer management |
| 516, 525 | IsochroneTool.js | `Map_.map.unproject(...)` | Projection |
| 569 | IsochroneTool.js | `.addTo(Map_.map)` | Layer management |
| 600, 603, 606, 611-613 | IsochroneTool.js | `Map_.map.on/off('click/mousemove/mouseout', ...)` | Internal events |
| 38 | IsochroneTool_Algorithm.js | `Map_.map.unproject(...)` | Projection |

### Map_.rmNotNull Calls

| Line | File | Pattern |
|------|------|---------|
| 272-273, 352-353, 397, 466, 510, 580 | IsochroneTool.js | `Map_.rmNotNull(...)` | Utility (keep) |

**Analysis**: Most Map_.map calls in IsochroneTool are for internal projection and layer management. `getMinZoom/getMaxZoom` could be migratable.

---

## 8. KindsTool

**Files**: `src/essence/Tools/Kinds/Kinds.js`

### Map_.* Direct Calls

| Line | Pattern | Category |
|------|---------|----------|
| 28 | `Map_.rmNotNull(Map_.tempOverlayImage)` | Utility |
| 155, 160 | `L.imageTransform(...).addTo(Map_.map)` | Layer management |
| 377 | `L_.Map_.map.getZoom()` | **Migratable** → `map:getZoom` |
| 385-386 | `Map_.map.layerPointToLatLng(...)` | Projection |
| 394 | `Map_.map.getBoundsZoom(...)` | Projection |
| 395 | `Map_.map.layerPointToLatLng(...)` | Projection |
| 405 | `Map_.map.setView(...)` | **Migratable** → `map:setView` |
| 463, 467 | `Map_.map.containerPointToLatLng(...)` | Projection |

### Globe_.* / L_.Globe_.* Direct Calls

| Line | Pattern | Category |
|------|---------|----------|
| 29 | `L_.Globe_.litho.removeLayer(...)` | Globe layer management |
| 300 | `L_.Globe_.litho.addLayer('model', ...)` | Globe layer management |

---

## 9. LayersTool

**Files**: `src/essence/Tools/Layers/LayersTool.js`

### Map_.map.* Direct Calls

| Line | Pattern | Migratable? |
|------|---------|-------------|
| 1805 | `Map_.map.fitBounds(layer.getBounds())` | **Yes** → `map:fitBounds` |
| 1807 | `Map_.map.fitBounds([[...], [...]])` | **Yes** → `map:fitBounds` |
| 3048 | `Map_.map.removeLayer(layer)` | Keep (internal refresh) |

### CustomEvent Dispatch

| Line | Event | Current | Needed |
|------|-------|---------|--------|
| 227-233 | `layersToolHeaderStateChange` | CustomEvent only | Add `mmgisAPI.emit('layer:headerStateChange', {...})` |
| 1531-1538 | `layerVisibilityChange` | CustomEvent only | Add `mmgisAPI.emit('layer:visibilityChange', {...})` |

### document.addEventListener

| Line | Pattern | New Pattern |
|------|---------|-------------|
| 3134 | `document.addEventListener('layerRefreshStatusChanged', ...)` | `mmgisAPI.on('layer:refreshStatusChange', ...)` |
| 3139 | `document.removeEventListener('layerRefreshStatusChanged', ...)` | Call stored unsubscribe |

---

## 10. LegendTool

**Files**: `src/essence/Tools/Legend/LegendTool.js`

### L_.subscribe* / L_.unsubscribe* Methods

| Line | Old Pattern | New Pattern |
|------|-------------|-------------|
| 38-40 | `L_.subscribeOnLayerToggle('LegendTool', ...)` | `mmgisAPI.on('layer:visibilityChange', ...)` |
| 58 | `L_.unsubscribeOnLayerToggle('LegendTool')` | Call stored unsubscribe |

### CustomEvent Dispatch (Already Dual-Emitted)

| Line | Pattern | Status |
|------|---------|--------|
| 44-53 | `new CustomEvent('madeLegendTool', ...)` + `mmgisAPI.emit('legend:made', ...)` | ✅ Done |

### ToolController_.getTool() Calls

| Line | Old Pattern | New Pattern | Provider Needed |
|------|-------------|-------------|-----------------|
| 110-111 | `ToolController_.getTool('LayersTool').populateCogScale(...)` | `mmgisAPI.request('plugin:layers:populateCogScale', ...)` | **NEW**: `plugin:layers:populateCogScale` |

### L_.missionPath Access

| Line | Old Pattern | New Provider Needed |
|------|-------------|---------------------|
| 341, 482 | `L_.missionPath` | `app:getMissionPath` |

---

## 11. MeasureTool

**Files**: `src/essence/Tools/Measure/MeasureTool.js`

### Map_.map.* Direct Calls

| Line | Pattern | Category |
|------|---------|----------|
| 814 | `Map_.map.removeControl(MeasureTool.polylineMeasure)` | Control management |
| 927, 932, 1645, 1649 | `Map_.map.removeLayer(...)` | Layer management |

### Globe_.litho.* Direct Calls

| Line | Pattern | Category |
|------|---------|----------|
| 72, 817 | `Globe_.litho.getContainer()` | Container access |
| 851-853, 928, 1037, 1057-1059, 1079-1081, 1575, 1694 | `Globe_.litho.removeLayer(...)` | Layer management |
| 960, 971-974 | `Globe_.litho.mouse.lat/lng` | **Migratable** → `globe:getMouse` |
| 1001, 1696, 1860 | `Globe_.litho.addLayer(...)` | Layer management |
| 1724, 1733 | `Globe_.litho.getElevationAtLngLat(...)` | New provider needed |
| 1858 | `Globe_.litho.getContainer()?.getBoundingClientRect()` | Container access |

**New Providers Needed**:
- `globe:getMouse` - Get mouse position on globe
- `globe:getElevation` - Get elevation at coordinates

---

## 12. ShadeTool

**Files**: `src/essence/Tools/Shade/ShadeTool.js`, `ShadeTool_Manager.js`

### Map_.map.* Direct Calls

| Line | File | Pattern | Migratable? |
|------|------|---------|-------------|
| 483, 485 | ShadeTool.js | `Map_.map.addLayer(...)` | Keep (internal) |
| 942 | ShadeTool.js | `Map_.map.containerPointToLatLng(...)` | Projection |
| 970 | ShadeTool.js | `Map_.map.getBounds()` | **Yes** → `map:getBounds` |
| 1081 | ShadeTool.js | `.addTo(Map_.map)` | Layer management |
| 1322 | ShadeTool.js | `Map_.map.getZoom()` | **Yes** → `map:getZoom` |
| 1336 | ShadeTool.js | `Map_.map.addLayer(...)` | Keep (internal) |
| 1748-1769 | ShadeTool.js | `Map_.map.on/off/dragging.enable/disable(...)` | Internal events |
| 1846-1869 | ShadeTool.js | `Map_.map.on/off('click/moveend', ...)` | Internal events |
| 58, 65, 99-102 | ShadeTool_Manager.js | `Map_.map.getZoom/getPixelBounds/unproject(...)` | Mixed |

### Globe_.litho.* Direct Calls

| Line | Pattern |
|------|---------|
| 1338 | `Globe_.litho.removeLayer(layerName)` |

---

## 13. SitesTool

**Files**: `src/essence/Tools/Sites/SitesTool.js`

**No direct calls found.** This tool is clean and doesn't need migration.

---

## 14. ViewshedTool

**Files**: `src/essence/Tools/Viewshed/ViewshedTool.js`, `ViewshedTool_Manager.js`

### Map_.map.* Direct Calls

| Line | File | Pattern | Migratable? |
|------|------|---------|-------------|
| 290, 294 | ViewshedTool.js | `Map_.map.getCenter().lat/lng` | **Yes** → `map:getCenter` |
| 516-524 | ViewshedTool.js | `Map_.map.addLayer(...)`, `Map_.rmNotNull(...)` | Keep (internal) |
| 939 | ViewshedTool.js | `Map_.getScreenDiagonalInMeters()` | Keep (utility) |
| 984 | ViewshedTool.js | `.addTo(Map_.map)` | Keep (internal) |
| 1043, 1050 | ViewshedTool.js | `Map_.rmNotNull(...)`, `.addTo(Map_.map)` | Keep |
| 1124 | ViewshedTool.js | `Map_.map.getBounds()` | **Yes** → `map:getBounds` |
| 1295 | ViewshedTool.js | `Map_.map.getZoom()` | **Yes** → `map:getZoom` |
| 1309 | ViewshedTool.js | `Map_.map.addLayer(...)` | Keep (internal) |
| 1532 | ViewshedTool.js | `Map_.map.getZoom()` | **Yes** → `map:getZoom` |
| 1591-1609 | ViewshedTool.js | `Map_.map.on/off('click/moveend', ...)` | Internal events |
| 56, 63, 98-103, 119, 229, 333, 441 | ViewshedTool_Manager.js | Various projection/zoom calls | Mixed |

### Globe_.litho.* Direct Calls

| Line | Pattern |
|------|---------|
| 1311, 1538 | `Globe_.litho.removeLayer(...)` |
| 1534-1535 | `Globe_.litho._.firstViewOverride = view`, `Globe_.litho.setCenter(...)` |
| 1539 | `Globe_.litho.addLayer('clamped', ...)` |

---

## 15. Summary Statistics

| Tool | L_.subscribe | CustomEvent | Map_.map Calls | Globe_.litho Calls | ToolController_.getTool | Map_.activeLayer | Total |
|------|--------------|-------------|----------------|-------------------|------------------------|------------------|-------|
| AnimationTool | 0 | 0 | ~25 | 0 | 0 | 0 | ~25 |
| ChemistryTool | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| CurtainTool | 0 | 0 | 3 | 10 | 0 | 0 | 13 |
| DrawTool | 4 | 0 | ~40 | 7 | 0 | 6 | ~57 |
| IdentifierTool | 3 | 0 | 5 | 8 | 0 | 0 | 16 |
| InfoTool | 0 | 0 | 2 | 0 | 0 | 0 | 2 |
| IsochroneTool | 0 | 0 | ~20 | 0 | 0 | 0 | ~20 |
| KindsTool | 0 | 0 | 8 | 2 | 0 | 0 | 10 |
| LayersTool | 0 | 2 | 3 | 0 | 0 | 0 | 5 |
| LegendTool | 2 | 1 (done) | 0 | 0 | 1 | 0 | 4 |
| MeasureTool | 0 | 0 | 5 | ~20 | 0 | 0 | ~25 |
| ShadeTool | 0 | 0 | ~15 | 1 | 0 | 0 | ~16 |
| SitesTool | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| ViewshedTool | 0 | 0 | ~20 | 5 | 0 | 0 | ~25 |
| **TOTAL** | **9** | **3** | **~146** | **~53** | **1** | **6** | **~218** |

---

## 16. Migration Priority

### Phase 1: Event Subscriptions (Highest Priority)

Convert all `L_.subscribe*` and `L_.unsubscribe*` patterns to event bus.

**Files to modify**:
- `DrawTool.js` (4 instances)
- `IdentifierTool.js` (3 instances - including bug fix)
- `LegendTool.js` (2 instances)

**Total: 9 instances**

### Phase 2: CustomEvent Dual-Emission

Add `mmgisAPI.emit()` alongside existing `CustomEvent` dispatches.

**Files to modify**:
- `LayersTool.js` (2 events: `layersToolHeaderStateChange`, `layerVisibilityChange`)
- `IdentifierTool.js` (bug fixes)

**Total: 2 events + 2 bug fixes**

### Phase 3: High-Value Map Providers

Migrate frequently-used map method calls to providers.

**Priority map methods** (most commonly used):
| Method | Usage Count | Provider |
|--------|-------------|----------|
| `getZoom()` | ~15 | `map:getZoom` ✅ (exists) |
| `getBounds()` | ~10 | `map:getBounds` ✅ (exists) |
| `getCenter()` | ~5 | `map:getCenter` ✅ (exists) |
| `fitBounds()` | ~8 | `map:fitBounds` ✅ (exists) |
| `panTo()` | ~10 | `map:panTo` ⚠️ (needs impl) |
| `setView()` | ~3 | `map:setView` ✅ (exists) |

**Priority tools**: DrawTool, InfoTool, LayersTool (user-facing navigation)

### Phase 4: Globe Providers

Add globe-specific providers for 3D operations.

**New providers needed**:
| Provider | Used By | Priority |
|----------|---------|----------|
| `globe:getMouse` | IdentifierTool, MeasureTool | High |
| `globe:getZoom` | IdentifierTool | High |
| `globe:getElevation` | MeasureTool | Medium |
| `globe:addLayer` | Multiple tools | Low (internal) |
| `globe:removeLayer` | Multiple tools | Low (internal) |

### Phase 5: Cross-Tool Communication

Replace `ToolController_.getTool()` calls with providers.

**Files to modify**:
- `LegendTool.js` → calls `LayersTool.populateCogScale()`

**New provider**: `plugin:layers:populateCogScale`

### Phase 6: Map_.activeLayer Migration

Replace direct `Map_.activeLayer` access with event subscriptions.

**Files to modify**:
- `DrawTool_Shapes.js` (~4 instances)
- `DrawTool_Files.js` (~4 instances)
- `DrawTool.js` (~2 instances)

**Approach**: Subscribe to `feature:active` event and maintain local state.

### Keep As-Is (Internal/Structural)

These patterns should NOT be migrated as they are internal implementation details:

1. **Drawing mode map events** (`Map_.map.on('click/mousemove/draw:created')`)
2. **Layer management** (`addTo(Map_.map)`, `removeLayer()`)
3. **Projection utilities** (`project/unproject/latLngToContainerPoint`)
4. **Control management** (`addControl/removeControl`)
5. **Map dragging** (`Map_.map.dragging.enable/disable`)
6. **Standard DOM events** (`document.addEventListener('keydown')`)

---

## Bugs Found During Analysis

| Tool | Line | Bug | Impact | Fix |
|------|------|-----|--------|-----|
| IdentifierTool | 49-51 | Duplicate `L_.subscribeOnLayerToggle` call | Double event handling | Delete duplicate |
| IdentifierTool | 618 | Wrong event in `removeEventListener` ('mousemove' vs 'mouseout') | Memory leak | Fix event name |

---

## New Providers to Implement

### Core Providers

| Provider | Location | Used By |
|----------|----------|---------|
| `map:panTo` | Map_.js | DrawTool, InfoTool, Description, TimeUI |
| `map:getMinZoom` | Map_.js | IsochroneTool |
| `map:getMaxZoom` | Map_.js | IsochroneTool |

### Globe Providers

| Provider | Location | Used By |
|----------|----------|---------|
| `globe:getMouse` | Globe_.js | IdentifierTool, MeasureTool |
| `globe:getZoom` | Globe_.js | IdentifierTool |
| `globe:getElevation` | Globe_.js | MeasureTool |

### Plugin Providers

| Provider | Location | Used By |
|----------|----------|---------|
| `plugin:layers:populateCogScale` | LayersTool.js | LegendTool |

### App Providers

| Provider | Location | Used By |
|----------|----------|---------|
| `app:getMissionPath` | mmgisAPI.js or Layers_.js | LegendTool |

---

## Events to Add (Emitter Side)

| Event | Payload | Location | Consumed By |
|-------|---------|----------|-------------|
| `layer:headerStateChange` | `{ header_id, onState }` | LayersTool.js:227 | External consumers |
| `layer:visibilityChange` | `{ layerName, on }` | LayersTool.js:1531 | Multiple tools |

---

## 17. Core Basics Modules Analysis

This section analyzes the core modules in `src/essence/Basics/` for event bus migration opportunities.

### ComponentController_

**Files**: `src/essence/Basics/ComponentController_/ComponentController_.js`

**Status**: ✅ Clean - No migration needed

No `L_.subscribe*`, `Map_.map.*`, `Globe_.litho.*`, `ToolController_.getTool()`, or `CustomEvent` patterns found.

---

### Formulae_

**Files**: `src/essence/Basics/Formulae_/Formulae_.js`

**Status**: ✅ Clean - No migration needed

Pure utility module with math/geometry functions. No event-related patterns.

---

### Globe_

**Files**: `src/essence/Basics/Globe_/Globe_.js`

**Status**: ⚠️ Partial migration needed

#### L_.subscribe* Patterns (Source: Subscriber)

| Line | Pattern | Migration Target |
|------|---------|------------------|
| 222 | `L_.subscribeTimeChange('globe_cesium_time', ...)` | `mmgisAPI.on('time:change', ...)` |

#### Map_.map.* Calls

| Line | Pattern | Migratable? |
|------|---------|-------------|
| 309-310 | `L_.Map_.map.getCenter()`, `L_.Map_.map.getZoom()` | **Yes** - Use existing providers |

#### Already Has Providers ✅

| Line | Provider |
|------|----------|
| 264 | `globe:getMouse` |
| 278 | `globe:getZoom` |

**Summary**: 1 subscription + 2 map calls to migrate. Already has some providers registered.

---

### Layers_

**Files**: `src/essence/Basics/Layers_/Layers_.js`

**Status**: ⚠️ **Source of Legacy Patterns** - Critical for migration

#### Legacy Subscription Definitions (These are the SOURCE, not consumers)

| Lines | Definition | Notes |
|-------|------------|-------|
| 226-232 | `_timeChangeSubscriptions`, `subscribeTimeChange`, `unsubscribeTimeChange` | Time change events |
| 234-241 | `_timeLayerReloadFinishSubscriptions`, `subscribeTimeLayerReloadFinish`, `unsubscribeTimeLayerReloadFinish` | Layer reload finish |
| 243-250 | `_onTimeUIToggleSubscriptions`, `subscribeOnTimeUIToggle`, `unsubscribeOnTimeUIToggle` | Time UI toggle |
| 252-259 | `_onLayerToggleSubscriptions`, `subscribeOnLayerToggle`, `unsubscribeOnLayerToggle` | Layer toggle |
| 261-271 | `_onSpecificLayerToggleSubscriptions`, `subscribeOnSpecificLayerToggle`, `unsubscribeOnSpecificLayerToggle` | Specific layer toggle |

**Migration Strategy**: These definitions should emit to the event bus when triggered. The trigger points are:
- Line 403-404: Triggers `_onLayerToggleSubscriptions`
- Line 407-408: Triggers `_onSpecificLayerToggleSubscriptions`

#### Already Has Providers ✅

| Lines | Provider |
|-------|----------|
| 168 | `layers:getAll` |
| 169 | `layers:getVisible` |
| 170-173 | `layers:getConfig` |
| 174-181 | `layers:toggle` |
| 182 | `app:getMissionPath` |

#### ToolController_.getTool() Calls

| Line | Pattern | Migration Target |
|------|---------|------------------|
| 2547 | `ToolController_.getTool('InfoTool')` | `mmgisAPI.request('plugin:info:showFeature', ...)` |
| 3223 | `ToolController_.getTool('InfoTool')` | `mmgisAPI.request('plugin:info:showFeature', ...)` |
| 3283 | `ToolController_.getTool('LayersTool')` | `mmgisAPI.request('plugin:layers:*', ...)` |

#### Map_.map.* Calls

| Line | Pattern | Migratable? |
|------|---------|-------------|
| 450 | `L_.Map_.map.hasLayer(...)` | Keep (internal) |
| 1437 | `L_.Map_.map.hasLayer(...)` | Keep (internal) |
| 1499 | `L_.Map_.map.getZoom()` | **Yes** → `map:getZoom` |
| 2480 | `L_.Map_.map.getZoom()` | **Yes** → `map:getZoom` |
| 2496 | `L_.Map_.map.getZoom()` | **Yes** → `map:getZoom` |
| 3605-3609 | `L_.Map_.map.containerPointToLatLng(...)` | Keep (projection) |

#### Globe_.litho.* Calls (~35 instances)

Globe calls are for internal layer management and should remain as-is. Key patterns:
- `Globe_.litho.setCenter()` - View control
- `Globe_.litho.toggleLayer()` / `addLayer()` / `removeLayer()` - Layer management
- `Globe_.litho.setLayerOpacity()` / `setLayerFilterEffect()` - Layer styling
- `Globe_.litho.orderLayers()` - Layer ordering

**Summary**: Layers_ is the **source** of legacy subscription patterns. Migration requires:
1. Adding `mmgisAPI.emit()` at trigger points (lines 403-410)
2. Migrating 3 `ToolController_.getTool()` calls
3. Migrating 3 `Map_.map.getZoom()` calls

---

### MapEngines

**Files**: `src/essence/Basics/MapEngines/*.ts`

**Status**: ✅ Clean - No migration needed

Infrastructure code for map engine abstraction. TypeScript interfaces and adapters. No event-related patterns.

---

### Map_

**Files**: `src/essence/Basics/Map_/Map_.js`

**Status**: ⚠️ Has providers + emitters (already migrated)

#### Already Has Providers ✅

| Line | Provider |
|------|----------|
| 227 | `map:getCenter` |
| 228 | `map:getBounds` |
| 229 | `map:getZoom` |
| 230-237 | `map:setView` |
| 238-241 | `map:fitBounds` |
| 242-245 | `map:panTo` |

#### Already Has Dual-Emission ✅

| Line | Event | Status |
|------|-------|--------|
| 970-971 | `feature:active` + `mmgisAPI.emit` | ✅ Done |
| 2165-2166 | `feature:active` + `mmgisAPI.emit` | ✅ Done |
| 2181-2182 | `feature:active` + `mmgisAPI.emit` | ✅ Done |

#### L_.subscribe* Patterns (Internal to Map_.js)

| Line | Pattern | Notes |
|------|---------|-------|
| 1007 | `L_.subscribeTimeChange(...)` | Internal layer time handling |
| 1011 | `L_.subscribeOnSpecificLayerToggle(...)` | Internal layer toggle |
| 1195 | `L_.subscribeTimeChange(...)` | Internal layer time handling |
| 1199 | `L_.subscribeOnSpecificLayerToggle(...)` | Internal layer toggle |

#### ToolController_.getTool() Calls

| Line | Pattern | Migration Target |
|------|---------|------------------|
| 1608 | `ToolController_.getTool('InfoTool').use(...)` | `mmgisAPI.request('plugin:info:showFeature', ...)` |

#### CustomEvent Dispatches (Need Dual-Emission)

| Line | Event | Status |
|------|-------|--------|
| 963-968 | `newActiveFeature` | ✅ Already dual-emitted |
| 1057-1066 | `layerTimeUpdated` | ⚠️ Needs dual-emit → `layer:timeUpdated` |
| 1146-1149 | `layerRefreshStatusChanged` | ⚠️ Needs dual-emit → `layer:refreshStatusChange` |
| 2114-2120 | `toggleSeparatedTool` | ⚠️ Needs dual-emit → `tool:toggleSeparated` |
| 2158-2163 | `newActiveFeature` | ✅ Already dual-emitted |
| 2174-2179 | `newActiveFeature` | ✅ Already dual-emitted |

**Summary**: Map_ has most providers in place. Remaining work:
1. Migrate 1 `ToolController_.getTool()` call
2. Add dual-emission to 3 CustomEvents

---

### Test_

**Files**: `src/essence/Basics/Test_/Test_.js`

**Status**: ⚠️ Minor - Testing utility

| Line | Pattern | Notes |
|------|---------|-------|
| 186 | `Map_.map.getCenter()` | Test utility |
| 191-194 | `Map_.map.fireEvent()`, `Map_.map.latLngToLayerPoint/ContainerPoint()` | Test simulation |

**Summary**: Testing utility module. Low priority, keep as-is for test functionality.

---

### TimeControl_

**Files**: `src/essence/Basics/TimeControl_/TimeControl.js`, `TimeUI.js`

**Status**: ⚠️ Has providers + triggers subscriptions

#### Already Has Providers ✅

| Line | Provider | File |
|------|----------|------|
| 63 | `time:getCurrent` | TimeControl.js |
| 64 | `time:getStart` | TimeControl.js |
| 65 | `time:getEnd` | TimeControl.js |
| 66-75 | `time:set` | TimeControl.js |

#### Triggers Legacy Subscriptions

| Line | Pattern | Notes |
|------|---------|-------|
| 639-641 | Iterates `L_._timeChangeSubscriptions` and calls each | **Add dual-emit** → `mmgisAPI.emit('time:change', {...})` |

#### L_.subscribe* Patterns (Consumer)

| Line | File | Pattern | Migration Target |
|------|------|---------|------------------|
| 1217 | TimeUI.js | `L_.subscribeOnTimeUIToggle(...)` | `mmgisAPI.on('time:toggleUI', ...)` |

#### Map_.map.* Calls

| Line | File | Pattern |
|------|------|---------|
| 2604 | TimeUI.js | `Map_.map.panTo(panTarget)` | **Yes** → `map:panTo` |

**Summary**: TimeControl has providers. Needs:
1. Add `mmgisAPI.emit('time:change')` at line 639
2. Migrate 1 subscription in TimeUI.js
3. Migrate 1 `Map_.map.panTo()` call

---

### ToolController_

**Files**: `src/essence/Basics/ToolController_/ToolController_.js`

**Status**: ✅ Already has dual-emission + `this.api` injection

#### Already Has Dual-Emission ✅

| Line | Event | Status |
|------|-------|--------|
| 171-185 | `toggleSeparatedTool` + `tool:toggleSeparated` | ✅ Done |
| 278-291 | `toolChange` + `tool:change` | ✅ Done |

#### this.api Injection ✅

| Line | Pattern | Status |
|------|---------|--------|
| 487-489 | Auto-injects `this.api = window.mmgisAPI.forPlugin(pluginId)` | ✅ Done |

**Summary**: ToolController_ is fully migrated with dual-emission and scoped API injection.

---

### UserInterface_

**Files**: `src/essence/Basics/UserInterface_/*.js`

**Status**: ⚠️ Minor migrations needed

#### Map_.map.* Calls

| Line | File | Pattern | Migratable? |
|------|------|---------|-------------|
| 139 | BottomBar.js | `L_.Map_.map.getCenter()` | **Yes** → `map:getCenter` |
| 1609 | UserInterfaceDefault_.js | `Map_.map.invalidateSize()` | Keep (internal) |
| 1785 | UserInterfaceDefault_.js | `Map_.map.invalidateSize()` | Keep (internal) |
| 1671 | UserInterfaceMobile_.js | `Map_.map.invalidateSize()` | Keep (internal) |
| 1847 | UserInterfaceMobile_.js | `Map_.map.invalidateSize()` | Keep (internal) |

#### Globe_.litho.* Calls

| Line | File | Pattern |
|------|------|---------|
| 584-585, 618-623 | BottomBar.js | `Globe_.litho.options.radiusOfTiles` | Keep (settings UI) |
| 1611, 1673 | UserInterfaceDefault_.js, UserInterfaceMobile_.js | `Globe_.litho.invalidateSize()` | Keep (internal) |

#### ToolController_.getTool() Calls

| Line | File | Pattern |
|------|------|---------|
| 763 | UserInterfaceDefault_.js | `ToolController_.getTool(ToolController_.activeToolName)?.width` | Keep (layout calc) |
| 813 | UserInterfaceMobile_.js | `ToolController_.getTool(ToolController_.activeToolName)?.width` | Keep (layout calc) |

#### mmgisAPI Usage

| Line | File | Pattern |
|------|------|---------|
| 523 | BottomBar.js | `window.mmgisAPI.toggleLayer(l.name)` | ✅ Already using API |

**Summary**: UserInterface_ has minimal migrations. 1 `map.getCenter()` call could use provider.

---

### Viewer_

**Files**: `src/essence/Basics/Viewer_/*.js`

**Status**: ⚠️ Minor - Photosphere module

| Line | File | Pattern |
|------|------|---------|
| 490, 495, 499 | Photosphere.js | `Map_.map.latLngToContainerPoint(...)`, `Map_.map.containerPointToLatLng(...)` | Keep (projection) |

**Summary**: Projection-related calls for Photosphere viewer. Keep as-is.

---

## 18. Updated Summary Statistics

### By Module Category

| Category | Modules | L_.subscribe | CustomEvent | Map_.map | Globe_.litho | ToolController_ | Status |
|----------|---------|--------------|-------------|----------|--------------|-----------------|--------|
| **Tools** | 14 | 9 | 3 | ~146 | ~53 | 1 | Partial |
| **Basics** | 11 | 5 | 3 | ~15 | ~40 | 5 | Partial |
| **TOTAL** | 25 | **14** | **6** | **~161** | **~93** | **6** | - |

### Basics Breakdown

| Module | Status | L_.subscribe | CustomEvent | Map_.map | Globe_.litho | ToolController_ |
|--------|--------|--------------|-------------|----------|--------------|-----------------|
| ComponentController_ | ✅ Clean | 0 | 0 | 0 | 0 | 0 |
| Formulae_ | ✅ Clean | 0 | 0 | 0 | 0 | 0 |
| Globe_ | ⚠️ Partial | 1 | 0 | 2 | N/A | 0 |
| Layers_ | ⚠️ Source | 0* | 0 | 7 | ~35 | 3 |
| MapEngines | ✅ Clean | 0 | 0 | 0 | 0 | 0 |
| Map_ | ⚠️ Partial | 4 | 3 | N/A | 0 | 1 |
| Test_ | ⚠️ Keep | 0 | 0 | 4 | 0 | 0 |
| TimeControl_ | ⚠️ Partial | 1 | 0 | 1 | 0 | 0 |
| ToolController_ | ✅ Done | 0 | 2 ✅ | 0 | 0 | N/A |
| UserInterface_ | ⚠️ Minor | 0 | 0 | 5 | 4 | 2 |
| Viewer_ | ⚠️ Keep | 0 | 0 | 3 | 0 | 0 |

*Note: Layers_ is the **source** of `L_.subscribe*` definitions, not a consumer.

---

## 19. New Events Needed (Emitter Side - Basics)

| Event | Payload | Location | Trigger Point |
|-------|---------|----------|---------------|
| `time:change` | `{ startTime, currentTime, endTime }` | TimeControl.js:639 | When `_timeChangeSubscriptions` triggered |
| `layer:timeUpdated` | `{ layer }` | Map_.js:1057 | After time-based layer refresh |
| `layer:refreshStatusChange` | `{ status }` | Map_.js:1146 | When layer refresh status changes |
| `layer:toggle` | `{ layerName, visible }` | Layers_.js:403 | When `_onLayerToggleSubscriptions` triggered |
| `layer:specificToggle` | `{ layerName, visible }` | Layers_.js:407 | When `_onSpecificLayerToggleSubscriptions` triggered |

---

*Document updated: 2026-03-26*
